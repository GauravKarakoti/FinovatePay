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

contract EscrowContract is
    ReentrancyGuard,
    ERC2771Context,
    IERC721Receiver,
    EIP712
{
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

    struct Proposal {
        address arbitrator;
        bool add;
        uint256 approvals;
        bool executed;
    }

    /*//////////////////////////////////////////////////////////////
                            STORAGE
    //////////////////////////////////////////////////////////////*/
    address public admin;
    address public treasury;
    address public keeper;
    address public timelock;
    uint256 public feeBasisPoints;

    ComplianceManager public complianceManager;

    mapping(bytes32 => Escrow) public escrows;

    // Meta-tx
    mapping(address => uint256) public nonces;
    bytes32 private constant META_TX_TYPEHASH =
        keccak256(
            "MetaTransaction(uint256 nonce,address from,bytes functionSignature)"
        );

    // Multi-sig arbitrator governance
    address[] public managers;
    mapping(address => bool) public isManager;
    uint256 public threshold;

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public approved;
    mapping(address => bool) public isArbitrator;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);
    event EscrowExpired(bytes32 indexed invoiceId);
    event EscrowCancelled(bytes32 indexed invoiceId);

    event ArbitratorProposed(uint256 indexed proposalId, address arbitrator, bool add);
    event ProposalApproved(uint256 indexed proposalId, address manager);
    event ProposalExecuted(uint256 indexed proposalId, address arbitrator, bool add);
    event ArbitratorAdded(address indexed arbitrator);
    event ArbitratorRemoved(address indexed arbitrator);

    event MetaTransactionExecuted(address indexed user, address indexed relayer, bytes functionSignature);

    event TreasuryUpdated(address indexed newTreasury);
    event FeeUpdated(uint256 newFeeBasisPoints);
    event ComplianceManagerUpdated(address indexed newComplianceManager);

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/
    modifier onlyAdmin() {
        require(_msgSender() == admin, "Not admin");
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
    )
        ERC2771Context(trustedForwarder)
        EIP712("EscrowContract", "1")
    {
        require(_complianceManager != address(0), "Bad compliance manager");
        require(_managers.length > 0, "No managers");
        require(
            _threshold > 0 && _threshold <= _managers.length,
            "Bad threshold"
        );

        admin = _msgSender();
        treasury = admin;
        keeper = admin;

        complianceManager = ComplianceManager(_complianceManager);

        for (uint256 i = 0; i < _managers.length; i++) {
            address m = _managers[i];
            require(m != address(0), "Bad manager");
            require(!isManager[m], "Duplicate manager");
            isManager[m] = true;
            managers.push(m);
        }

        threshold = _threshold;

        emit ComplianceManagerUpdated(_complianceManager);
    }

    /*//////////////////////////////////////////////////////////////
                            ESCROW LOGIC
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

    function deposit(bytes32 invoiceId) external nonReentrant {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Created, "Inactive");
        require(_msgSender() == e.buyer, "Not buyer");
        require(block.timestamp < e.expiresAt, "Expired");

        IERC20(e.token).transferFrom(_msgSender(), address(this), e.amount);

        e.buyerConfirmed = true;
        e.status = EscrowStatus.Funded;

        emit DepositConfirmed(invoiceId, _msgSender(), e.amount);
    }

    function confirmRelease(bytes32 invoiceId)
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

        e.status = EscrowStatus.Disputed;
        e.disputeRaised = true;

        emit DisputeRaised(invoiceId, _msgSender());
    }

    function resolveDispute(bytes32 invoiceId, bool sellerWins)
        external
        onlyAdmin
    {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Disputed, "No dispute");

        e.disputeResolver = _msgSender();

        if (sellerWins) {
            IERC20(e.token).transfer(e.seller, e.amount);
        } else {
            IERC20(e.token).transfer(e.buyer, e.amount);
        }

        if (e.rwaNftContract != address(0)) {
            IERC721(e.rwaNftContract).transferFrom(
                address(this),
                sellerWins ? e.buyer : e.seller,
                e.rwaTokenId
            );
        }

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

        emit EscrowReleased(invoiceId, e.amount);
        delete escrows[invoiceId];
    }

    /*//////////////////////////////////////////////////////////////
                    MULTI-SIG ARBITRATORS
    //////////////////////////////////////////////////////////////*/
    function proposeAddArbitrator(address arbitrator) external onlyManager {
        proposals[proposalCount] = Proposal(
            arbitrator,
            true,
            0,
            false
        );
        emit ArbitratorProposed(proposalCount++, arbitrator, true);
    }

    function proposeRemoveArbitrator(address arbitrator) external onlyManager {
        proposals[proposalCount] = Proposal(
            arbitrator,
            false,
            0,
            false
        );
        emit ArbitratorProposed(proposalCount++, arbitrator, false);
    }

    function approveProposal(uint256 proposalId) external onlyManager {
        Proposal storage p = proposals[proposalId];
        require(!p.executed, "Executed");
        require(!approved[proposalId][_msgSender()], "Approved");

        approved[proposalId][_msgSender()] = true;
        p.approvals++;

        emit ProposalApproved(proposalId, _msgSender());
    }

    function executeProposal(uint256 proposalId) external onlyManager {
        Proposal storage p = proposals[proposalId];
        require(!p.executed, "Executed");
        require(p.approvals >= threshold, "Insufficient approvals");

        p.executed = true;

        if (p.add) {
            isArbitrator[p.arbitrator] = true;
            emit ArbitratorAdded(p.arbitrator);
        } else {
            isArbitrator[p.arbitrator] = false;
            emit ArbitratorRemoved(p.arbitrator);
        }

        emit ProposalExecuted(proposalId, p.arbitrator, p.add);
    }

    /*//////////////////////////////////////////////////////////////
                        META TX
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

        address signer = _hashTypedDataV4(structHash).recover(signature);
        require(signer == user, "Bad signature");

        nonces[user]++;

        (bool success, bytes memory data) =
            address(this).call(abi.encodePacked(functionSignature, user));
        require(success, "Meta-tx failed");

        emit MetaTransactionExecuted(user, _msgSender(), functionSignature);
        return data;
    }

    /*//////////////////////////////////////////////////////////////
                    ERC2771 OVERRIDES
    //////////////////////////////////////////////////////////////*/
    function _msgSender()
        internal
        view
        override(ERC2771Context)
        returns (address)
    {
        return ERC2771Context._msgSender();
    }

    function _msgData()
        internal
        view
        override(ERC2771Context)
        returns (bytes calldata)
    {
        return ERC2771Context._msgData();
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