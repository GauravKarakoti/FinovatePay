// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./ComplianceManager.sol";

contract EscrowContract is ReentrancyGuard, EIP712, IERC721Receiver {
    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/
    enum EscrowStatus {
        Created,
        Funded,
        Disputed,
        Released,
        Expired
    }

    struct Escrow {
        address seller;
        address buyer;
        uint256 amount;
        address token;
        EscrowStatus status;
        bool sellerConfirmed;
        bool buyerConfirmed;
        bool disputeRaised;
        address disputeResolver;
        uint256 createdAt;
        uint256 expiresAt;
        address rwaNftContract;
        uint256 rwaTokenId;
    }

    /*//////////////////////////////////////////////////////////////
                            STATE
    //////////////////////////////////////////////////////////////*/
    mapping(bytes32 => Escrow) public escrows;

    address public admin;
    ComplianceManager public complianceManager;

    /*//////////////////////////////////////////////////////////////
                        META-TX STATE
    //////////////////////////////////////////////////////////////*/
    mapping(address => uint256) public nonces;
    bytes32 private constant _TYPEHASH =
        keccak256("MetaTransaction(uint256 nonce,address from,bytes functionSignature)");

    /*//////////////////////////////////////////////////////////////
                        MULTI-SIG ARBITRATORS
    //////////////////////////////////////////////////////////////*/
    mapping(address => bool) public isManager;
    address[] public managers;
    uint256 public threshold;

    mapping(address => bool) public isArbitrator;

    struct Proposal {
        address target;
        bool add;
        uint256 approvals;
        bool executed;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public approved;
    uint256 public proposalCount;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);

    event ArbitratorProposed(uint256 id, address target, bool add);
    event ArbitratorApproved(uint256 id, address manager);
    event ArbitratorExecuted(uint256 id, address target, bool add);

    /*//////////////////////////////////////////////////////////////
                            MODIFIERS
    //////////////////////////////////////////////////////////////*/
    modifier onlyAdmin() {
        require(_msgSender() == admin, "Not admin");
        _;
    }

    modifier onlyManager() {
        require(isManager[msg.sender], "Not manager");
        _;
    }

    modifier onlyCompliant(address user) {
        require(complianceManager.isCompliant(user), "Not compliant");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
    constructor(
        address _complianceManager,
        address[] memory _managers,
        uint256 _threshold
    ) EIP712("EscrowContract", "1") {
        require(_threshold > 0 && _threshold <= _managers.length, "Bad threshold");

        admin = msg.sender;
        complianceManager = ComplianceManager(_complianceManager);

        for (uint256 i; i < _managers.length; i++) {
            isManager[_managers[i]] = true;
            managers.push(_managers[i]);
        }
        threshold = _threshold;
    }

    /*//////////////////////////////////////////////////////////////
                        ESCROW CORE LOGIC
    //////////////////////////////////////////////////////////////*/
    function createEscrow(
        bytes32 invoiceId,
        address seller,
        address buyer,
        uint256 amount,
        address token,
        uint256 duration,
        address rwaNft,
        uint256 rwaTokenId
    ) external onlyAdmin {
        require(escrows[invoiceId].seller == address(0), "Exists");

        if (rwaNft != address(0)) {
            IERC721(rwaNft).transferFrom(seller, address(this), rwaTokenId);
        }

        escrows[invoiceId] = Escrow({
            seller: seller,
            buyer: buyer,
            amount: amount,
            token: token,
            status: EscrowStatus.Created,
            sellerConfirmed: false,
            buyerConfirmed: false,
            disputeRaised: false,
            disputeResolver: address(0),
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            rwaNftContract: rwaNft,
            rwaTokenId: rwaTokenId
        });

        emit EscrowCreated(invoiceId, seller, buyer, amount);
    }

    function deposit(bytes32 invoiceId, uint256 amount)
        external
        nonReentrant
        onlyCompliant(msg.sender)
    {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Created, "Inactive");
        require(msg.sender == e.buyer, "Not buyer");
        require(amount == e.amount, "Bad amount");
        require(block.timestamp < e.expiresAt, "Expired");

        IERC20(e.token).transferFrom(msg.sender, address(this), amount);
        e.buyerConfirmed = true;
        e.status = EscrowStatus.Funded;

        emit DepositConfirmed(invoiceId, msg.sender, amount);
    }

    function confirmRelease(bytes32 invoiceId) external nonReentrant {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Funded, "Not funded");
        require(msg.sender == e.seller || msg.sender == e.buyer, "Not party");

        msg.sender == e.seller
            ? e.sellerConfirmed = true
            : e.buyerConfirmed = true;

        if (e.sellerConfirmed && e.buyerConfirmed) {
            _release(invoiceId);
        }
    }

    function raiseDispute(bytes32 invoiceId) external {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Funded, "No dispute");
        require(msg.sender == e.seller || msg.sender == e.buyer, "Not party");

        e.disputeRaised = true;
        e.status = EscrowStatus.Disputed;

        emit DisputeRaised(invoiceId, msg.sender);
    }

    function resolveDispute(bytes32 invoiceId, bool sellerWins) external onlyAdmin {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Disputed, "No dispute");

        e.disputeResolver = msg.sender;
        IERC20 token = IERC20(e.token);

        if (sellerWins) {
            token.transfer(e.seller, e.amount);
            if (e.rwaNftContract != address(0))
                IERC721(e.rwaNftContract).transferFrom(address(this), e.buyer, e.rwaTokenId);
        } else {
            token.transfer(e.buyer, e.amount);
            if (e.rwaNftContract != address(0))
                IERC721(e.rwaNftContract).transferFrom(address(this), e.seller, e.rwaTokenId);
        }

        e.status = EscrowStatus.Released;
        emit DisputeResolved(invoiceId, msg.sender, sellerWins);
        delete escrows[invoiceId];
    }

    function _release(bytes32 invoiceId) internal {
        Escrow storage e = escrows[invoiceId];
        IERC20(e.token).transfer(e.seller, e.amount);

        if (e.rwaNftContract != address(0))
            IERC721(e.rwaNftContract).transferFrom(address(this), e.buyer, e.rwaTokenId);

        e.status = EscrowStatus.Released;
        emit EscrowReleased(invoiceId, e.amount);
        delete escrows[invoiceId];
    }

    /*//////////////////////////////////////////////////////////////
                        META TRANSACTIONS
    //////////////////////////////////////////////////////////////*/
    function executeMetaTx(
        address user,
        bytes calldata data,
        bytes calldata sig
    ) external returns (bytes memory) {
        bytes32 hash = _hashTypedDataV4(
            keccak256(abi.encode(_TYPEHASH, nonces[user]++, user, keccak256(data)))
        );

        require(ECDSA.recover(hash, sig) == user, "Bad sig");

        (bool ok, bytes memory res) = address(this).call(
            abi.encodePacked(data, user)
        );
        require(ok, "Call failed");

        return res;
    }

    function _msgSender() internal view returns (address) {
        if (msg.sender == address(this)) {
            return address(bytes20(msg.data[msg.data.length - 20:]));
        }
        return msg.sender;
    }

    /*//////////////////////////////////////////////////////////////
                        ERC721 RECEIVER
    //////////////////////////////////////////////////////////////*/
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}