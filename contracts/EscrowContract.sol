// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./ComplianceManager.sol";

contract EscrowContract is ReentrancyGuard, ERC2771Context, IERC721Receiver, EIP712 {
    using ECDSA for bytes32;
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

    address[] public managers;
    mapping(address => bool) public isManager;
    uint256 public threshold;

    struct Proposal {
        address arbitrator;
        bool add;
        uint256 approvals;
        bool executed;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public approved;
    mapping(address => bool) public isArbitrator;
    mapping(address => uint256) public nonces;

    bytes32 private constant META_TX_TYPEHASH =
        keccak256("MetaTransaction(uint256 nonce,address from,bytes functionSignature)");

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);
    event ArbitratorProposed(uint256 indexed proposalId, address arbitrator, bool add);
    event ProposalApproved(uint256 indexed proposalId, address manager);
    event ProposalExecuted(uint256 indexed proposalId, address arbitrator, bool add);
    event ArbitratorAdded(address indexed arbitrator);
    event ArbitratorRemoved(address indexed arbitrator);
    event MetaTransactionExecuted(address indexed user, address indexed relayer, bytes functionSignature);

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/
    modifier onlyAdmin() {
        require(_msgSender() == admin, "Not admin");
        _;
    }

    modifier onlyCompliant(address user) {
        require(complianceManager.isCompliant(user), "Not compliant");
        _;
    }

    modifier onlyManager() {
        require(isManager[_msgSender()], "Not manager");
        _;
    }

    modifier onlyEscrowParty(bytes32 invoiceId) {
        Escrow storage e = escrows[invoiceId];
        require(
            _msgSender() == e.seller || _msgSender() == e.buyer,
            "Not party"
        );
        _;
    }

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
    constructor(
        address _complianceManager,
        address trustedForwarder,
        address[] memory _managers,
        uint256 _threshold
    ) ERC2771Context(trustedForwarder) EIP712("EscrowContract", "1") {
        admin = _msgSender();
        complianceManager = ComplianceManager(_complianceManager);

        require(_managers.length > 0, "No managers");
        require(_threshold > 0 && _threshold <= _managers.length, "Bad threshold");

        for (uint256 i = 0; i < _managers.length; i++) {
            address manager = _managers[i];
            require(manager != address(0), "Bad manager");
            require(!isManager[manager], "Duplicate manager");
            isManager[manager] = true;
            managers.push(manager);
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
        require(escrows[invoiceId].seller == address(0), "Escrow exists");

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

    function deposit(
        bytes32 invoiceId,
        uint256 amount
    )
        external
        nonReentrant
        onlyCompliant(_msgSender())
    {
        Escrow storage e = escrows[invoiceId];

        require(e.status == EscrowStatus.Created, "Inactive");
        require(_msgSender() == e.buyer, "Not buyer");
        require(amount == e.amount, "Bad amount");
        require(block.timestamp < e.expiresAt, "Expired");

        IERC20(e.token).transferFrom(_msgSender(), address(this), amount);

        e.buyerConfirmed = true;
        e.status = EscrowStatus.Funded;

        emit DepositConfirmed(invoiceId, _msgSender(), amount);
    }

    function confirmRelease(
        bytes32 invoiceId
    )
        external
        nonReentrant
        onlyEscrowParty(invoiceId)
    {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Funded, "Not funded");

        if (_msgSender() == e.seller) e.sellerConfirmed = true;
        else e.buyerConfirmed = true;

        if (e.sellerConfirmed && e.buyerConfirmed) {
            _release(invoiceId);
        }
    }

    function raiseDispute(bytes32 invoiceId)
        external
        onlyEscrowParty(invoiceId)
    {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Funded, "No dispute");

        e.disputeRaised = true;
        e.status = EscrowStatus.Disputed;

        emit DisputeRaised(invoiceId, _msgSender());
    }

    function resolveDispute(
        bytes32 invoiceId,
        bool sellerWins
    )
        external
        onlyAdmin
    {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Disputed, "No dispute");

        e.disputeResolver = _msgSender();
        IERC20 token = IERC20(e.token);

        if (sellerWins) {
            token.transfer(e.seller, e.amount);
            if (e.rwaNftContract != address(0)) {
                IERC721(e.rwaNftContract).transferFrom(
                    address(this),
                    e.buyer,
                    e.rwaTokenId
                );
            }
        } else {
            token.transfer(e.buyer, e.amount);
            if (e.rwaNftContract != address(0)) {
                IERC721(e.rwaNftContract).transferFrom(
                    address(this),
                    e.seller,
                    e.rwaTokenId
                );
            }
        }

        e.status = EscrowStatus.Released;
        emit DisputeResolved(invoiceId, _msgSender(), sellerWins);
        delete escrows[invoiceId];
    }

    function _release(bytes32 invoiceId) internal {
        Escrow storage e = escrows[invoiceId];

        IERC20(e.token).transfer(e.seller, e.amount);

        if (e.rwaNftContract != address(0)) {
            IERC721(e.rwaNftContract).transferFrom(
                address(this),
                e.buyer,
                e.rwaTokenId
            );
        }

        e.status = EscrowStatus.Released;
        emit EscrowReleased(invoiceId, e.amount);
        delete escrows[invoiceId];
    }

    /*//////////////////////////////////////////////////////////////
                        META-TRANSACTIONS
    //////////////////////////////////////////////////////////////*/
    function executeMetaTx(
        address user,
        bytes calldata functionSignature,
        bytes calldata signature
    ) external returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                META_TX_TYPEHASH,
                nonces[user],
                user,
                keccak256(functionSignature)
            )
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);
        require(signer == user, "Invalid signature");

        nonces[user] += 1;

        (bool success, bytes memory returnData) =
            address(this).call(abi.encodePacked(functionSignature, user));
        require(success, "Meta-tx failed");

        emit MetaTransactionExecuted(user, _msgSender(), functionSignature);
        return returnData;
    }

    /*//////////////////////////////////////////////////////////////
                    MULTI-SIG ARBITRATOR MANAGEMENT
    //////////////////////////////////////////////////////////////*/
    function proposeAddArbitrator(address arbitrator) external onlyManager {
        require(arbitrator != address(0), "Bad arbitrator");
        require(!isArbitrator[arbitrator], "Already arbitrator");

        uint256 proposalId = proposalCount;
        proposals[proposalId] = Proposal({
            arbitrator: arbitrator,
            add: true,
            approvals: 0,
            executed: false
        });

        proposalCount += 1;
        emit ArbitratorProposed(proposalId, arbitrator, true);
    }

    function proposeRemoveArbitrator(address arbitrator) external onlyManager {
        require(arbitrator != address(0), "Bad arbitrator");
        require(isArbitrator[arbitrator], "Not arbitrator");

        uint256 proposalId = proposalCount;
        proposals[proposalId] = Proposal({
            arbitrator: arbitrator,
            add: false,
            approvals: 0,
            executed: false
        });

        proposalCount += 1;
        emit ArbitratorProposed(proposalId, arbitrator, false);
    }

    function approveProposal(uint256 proposalId) external onlyManager {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.arbitrator != address(0), "Bad proposal");
        require(!proposal.executed, "Executed");
        require(!approved[proposalId][_msgSender()], "Already approved");

        approved[proposalId][_msgSender()] = true;
        proposal.approvals += 1;

        emit ProposalApproved(proposalId, _msgSender());
    }

    function executeProposal(uint256 proposalId) external onlyManager {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.arbitrator != address(0), "Bad proposal");
        require(!proposal.executed, "Executed");
        require(proposal.approvals >= threshold, "Insufficient approvals");

        proposal.executed = true;

        if (proposal.add) {
            addArbitrator(proposal.arbitrator);
        } else {
            removeArbitrator(proposal.arbitrator);
        }

        emit ProposalExecuted(proposalId, proposal.arbitrator, proposal.add);
    }

    function addArbitrator(address arbitrator) internal {
        require(arbitrator != address(0), "Bad arbitrator");
        require(!isArbitrator[arbitrator], "Already arbitrator");
        isArbitrator[arbitrator] = true;
        emit ArbitratorAdded(arbitrator);
    }

    /*//////////////////////////////////////////////////////////////
                        CONTEXT OVERRIDES
    //////////////////////////////////////////////////////////////*/
    function _msgSender() internal view virtual override(ERC2771Context) returns (address) {
        if (msg.sender == address(this) && msg.data.length >= 20) {
            address sender;
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
            return sender;
        }
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view virtual override(ERC2771Context) returns (bytes calldata) {
        if (msg.sender == address(this) && msg.data.length >= 20) {
            return msg.data[:msg.data.length - 20];
        }
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view virtual override(ERC2771Context) returns (uint256) {
        if (msg.sender == address(this)) {
            return 20;
        }
        return ERC2771Context._contextSuffixLength();
    }

    function removeArbitrator(address arbitrator) internal {
        require(isArbitrator[arbitrator], "Not arbitrator");
        isArbitrator[arbitrator] = false;
        emit ArbitratorRemoved(arbitrator);
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
