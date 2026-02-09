// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./ComplianceManager.sol";

contract EscrowContract is ReentrancyGuard, EIP712, IERC721Receiver {

    enum EscrowStatus {
        Created,
        Funded,
        Released,
        Disputed,
        Expired
    }

    struct Escrow {
        address seller;
        address buyer;
        address arbitrator;
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

    mapping(bytes32 => Escrow) public escrows;
    mapping(address => bool) public arbitrators;

    ComplianceManager public complianceManager;
    address public admin;
    address public treasury;
    address public keeper;
    uint256 public feeBasisPoints;

    // ================= MULTISIG =================

    mapping(address => bool) public managers;
    uint256 public approvalThreshold;
    uint256 public proposalCount;

    enum Action { AddArbitrator, RemoveArbitrator }

    struct Proposal {
        address arbitrator;
        Action action;
        uint256 approvals;
        bool executed;
        mapping(address => bool) approvedBy;
    }

    mapping(uint256 => Proposal) public proposals;

    // ================= META TX =================

    mapping(address => uint256) public nonces;

    bytes32 private constant META_TX_TYPEHASH =
        keccak256("MetaTx(address user,bytes functionData,uint256 nonce)");

    // ================= EVENTS =================

    event EscrowCreated(bytes32 indexed invoiceId);
    event DepositConfirmed(bytes32 indexed invoiceId);
    event EscrowReleased(bytes32 indexed invoiceId);
    event DisputeRaised(bytes32 indexed invoiceId);
    event DisputeResolved(bytes32 indexed invoiceId, bool sellerWins);
    event EscrowExpired(bytes32 indexed invoiceId);
    event FeeTaken(bytes32 indexed invoiceId, uint256 fee);
    event MetaTxExecuted(address user, uint256 nonce);

    event ProposalCreated(uint256 id, address arbitrator, Action action);
    event ProposalApproved(uint256 id, address manager);
    event ProposalExecuted(uint256 id);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier onlyManager() {
        require(managers[msg.sender], "Not manager");
        _;
    }

    modifier onlyAdminOrArbitrator() {
        require(
            msg.sender == admin || arbitrators[msg.sender],
            "Not admin or arbitrator"
        );
        _;
    }

    modifier onlyCompliant(address user) {
        require(!complianceManager.isFrozen(user), "Frozen");
        require(complianceManager.hasIdentity(user), "No identity");
        _;
    }

    constructor(address _compliance) EIP712("FinovatePay", "1") {
        admin = msg.sender;
        treasury = msg.sender;
        keeper = msg.sender;
        complianceManager = ComplianceManager(_compliance);

        managers[msg.sender] = true;
        approvalThreshold = 1;
    }

    // ================= META SENDER =================

    function _msgSenderMeta() internal view returns (address sender) {
        if (msg.sender == address(this)) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }

    // ================= ESCROW =================

    function createEscrow(
        bytes32 id,
        address seller,
        address buyer,
        address arbitrator,
        uint256 amount,
        address token,
        uint256 duration,
        address nft,
        uint256 nftId
    ) external onlyCompliant(_msgSenderMeta()) {
        require(escrows[id].seller == address(0), "Exists");

        escrows[id] = Escrow({
            seller: seller,
            buyer: buyer,
            arbitrator: arbitrator == address(0) ? admin : arbitrator,
            amount: amount,
            token: token,
            status: EscrowStatus.Created,
            sellerConfirmed: false,
            buyerConfirmed: false,
            disputeRaised: false,
            disputeResolver: address(0),
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            rwaNftContract: nft,
            rwaTokenId: nftId
        });

        if (nft != address(0)) {
            IERC721(nft).transferFrom(seller, address(this), nftId);
        }

        emit EscrowCreated(id);
    }

    function deposit(bytes32 id) external nonReentrant onlyCompliant(_msgSenderMeta()) {
        Escrow storage e = escrows[id];
        require(e.status == EscrowStatus.Created, "Invalid");

        IERC20(e.token).transferFrom(_msgSenderMeta(), address(this), e.amount);
        e.status = EscrowStatus.Funded;

        emit DepositConfirmed(id);
    }

    function raiseDispute(bytes32 id) external {
        Escrow storage e = escrows[id];
        require(e.status == EscrowStatus.Funded, "Invalid");
        e.status = EscrowStatus.Disputed;
        e.disputeRaised = true;

        emit DisputeRaised(id);
    }

    function resolveDispute(bytes32 id, bool sellerWins)
        external
        nonReentrant
        onlyAdminOrArbitrator
    {
        Escrow storage e = escrows[id];
        require(e.status == EscrowStatus.Disputed, "No dispute");

        IERC20 token = IERC20(e.token);

        if (sellerWins) {
            uint256 fee = (e.amount * feeBasisPoints) / 10000;
            token.transfer(e.seller, e.amount - fee);
            if (fee > 0) token.transfer(treasury, fee);
        } else {
            token.transfer(e.buyer, e.amount);
        }

        if (e.rwaNftContract != address(0)) {
            IERC721(e.rwaNftContract).transferFrom(
                address(this),
                sellerWins ? e.buyer : e.seller,
                e.rwaTokenId
            );
        }

        delete escrows[id];
        emit DisputeResolved(id, sellerWins);
    }

    // ================= META TX =================

    function executeMetaTx(
        address user,
        bytes calldata data,
        bytes calldata sig
    ) external {
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(
                META_TX_TYPEHASH,
                user,
                keccak256(data),
                nonces[user]++
            ))
        );

        require(ECDSA.recover(digest, sig) == user, "Bad sig");

        (bool ok,) = address(this).call(abi.encodePacked(data, user));
        require(ok, "Meta failed");

        emit MetaTxExecuted(user, nonces[user] - 1);
    }

    function onERC721Received(...) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}