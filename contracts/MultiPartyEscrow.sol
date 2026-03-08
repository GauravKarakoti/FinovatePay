// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MultiPartyEscrow
 * @notice Advanced escrow supporting complex B2B transactions with multiple stakeholders
 *         (buyer, seller, supplier, logistics) and programmable milestone-based conditional release.
 * @dev Funds are held on-chain and released incrementally as milestones receive the required approvals.
 *      The contract owner (backend relayer/admin) manages escrow lifecycle; participants approve milestones.
 */
contract MultiPartyEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────── TYPES ───────────────────────────────────

    enum EscrowStatus   { Active, Released, Cancelled }
    enum MilestoneStatus { Pending, InProgress, Approved, Disputed }

    struct Participant {
        address wallet;
        string  role;     // "buyer" | "seller" | "supplier" | "logistics" | "arbiter"
        bool    isActive;
    }

    /// @dev Milestone approval bitmaps are stored in a separate mapping to avoid nested mappings
    ///      in structs that would complicate storage layout.
    struct Milestone {
        string          title;
        string          description;
        uint256         amount;            // amount released upon completion (6-decimal USDC scale)
        uint256         requiredApprovals;
        uint256         approvalCount;
        MilestoneStatus status;
    }

    struct Escrow {
        address token;           // ERC-20 token address; address(0) = native ETH
        uint256 totalAmount;
        uint256 releasedAmount;
        uint256 milestoneCount;
        uint256 participantCount;
        uint256 createdAt;
        uint256 expiresAt;       // 0 = no expiry
        EscrowStatus status;
    }

    // ─────────────────────────────── STATE ───────────────────────────────────

    /// escrowId → Escrow
    mapping(bytes32 => Escrow) public escrows;

    /// escrowId → index → Milestone
    mapping(bytes32 => mapping(uint256 => Milestone)) public milestones;

    /// escrowId → index → Participant
    mapping(bytes32 => mapping(uint256 => Participant)) public participants;

    /// escrowId → wallet → isParticipant
    mapping(bytes32 => mapping(address => bool)) public isParticipant;

    /// escrowId → milestoneIndex → approver → hasApproved
    mapping(bytes32 => mapping(uint256 => mapping(address => bool))) public hasApproved;

    // ─────────────────────────────── EVENTS ──────────────────────────────────

    event EscrowCreated(bytes32 indexed escrowId, address indexed creator, uint256 totalAmount, address token);
    event FundsDeposited(bytes32 indexed escrowId, address indexed depositor, uint256 amount);
    event ParticipantAdded(bytes32 indexed escrowId, address indexed participant, string role);
    event MilestoneCreated(bytes32 indexed escrowId, uint256 indexed milestoneIndex, string title, uint256 amount);
    event MilestoneApproved(bytes32 indexed escrowId, uint256 indexed milestoneIndex, address indexed approver, uint256 approvalCount);
    event MilestoneCompleted(bytes32 indexed escrowId, uint256 indexed milestoneIndex, uint256 amountReleased, address recipient);
    event EscrowFullyReleased(bytes32 indexed escrowId);
    event EscrowCancelled(bytes32 indexed escrowId, uint256 refundAmount);

    // ─────────────────────────────── MODIFIERS ───────────────────────────────

    modifier escrowExists(bytes32 escrowId) {
        require(escrows[escrowId].createdAt != 0, "MultiPartyEscrow: escrow not found");
        _;
    }

    modifier onlyParticipant(bytes32 escrowId) {
        require(isParticipant[escrowId][msg.sender], "MultiPartyEscrow: caller is not a participant");
        _;
    }

    modifier escrowActive(bytes32 escrowId) {
        require(escrows[escrowId].status == EscrowStatus.Active, "MultiPartyEscrow: escrow is not active");
        _;
    }

    // ─────────────────────────────── CONSTRUCTOR ─────────────────────────────

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ───────────────────────── ESCROW LIFECYCLE ──────────────────────────────

    /**
     * @notice Create a new multi-party escrow.
     * @param escrowId       Unique bytes32 ID derived from a UUID (see uuidToBytes32 in backend).
     * @param token          ERC-20 token (address(0) for native ETH).
     * @param totalAmount    Total escrow amount (in token's smallest unit).
     * @param duration       Lock duration in seconds (0 = no expiry).
     * @param wallets        Ordered list of initial participant wallet addresses.
     * @param roles          Corresponding roles for each wallet.
     */
    function createEscrow(
        bytes32        escrowId,
        address        token,
        uint256        totalAmount,
        uint256        duration,
        address[] calldata wallets,
        string[]  calldata roles
    ) external onlyOwner {
        require(escrows[escrowId].createdAt == 0, "MultiPartyEscrow: escrow already exists");
        require(totalAmount > 0,                  "MultiPartyEscrow: amount must be > 0");
        require(wallets.length == roles.length,   "MultiPartyEscrow: array length mismatch");
        require(wallets.length >= 2,              "MultiPartyEscrow: minimum 2 participants required");

        Escrow storage e = escrows[escrowId];
        e.token           = token;
        e.totalAmount     = totalAmount;
        e.status          = EscrowStatus.Active;
        e.createdAt       = block.timestamp;
        e.expiresAt       = duration > 0 ? block.timestamp + duration : 0;

        for (uint256 i = 0; i < wallets.length; i++) {
            _addParticipant(escrowId, wallets[i], roles[i]);
        }

        emit EscrowCreated(escrowId, msg.sender, totalAmount, token);
    }

    /**
     * @notice Deposit funds into an active escrow.
     *         For ERC-20 tokens the caller must have pre-approved this contract.
     *         For ETH, msg.value must equal escrow.totalAmount.
     */
    function deposit(bytes32 escrowId)
        external
        payable
        nonReentrant
        escrowExists(escrowId)
        escrowActive(escrowId)
        onlyParticipant(escrowId)
    {
        Escrow storage e = escrows[escrowId];
        if (e.token == address(0)) {
            require(msg.value == e.totalAmount, "MultiPartyEscrow: incorrect ETH amount");
        } else {
            require(msg.value == 0, "MultiPartyEscrow: ETH sent for token escrow");
            IERC20(e.token).safeTransferFrom(msg.sender, address(this), e.totalAmount);
        }
        emit FundsDeposited(escrowId, msg.sender, e.totalAmount);
    }

    // ──────────────────────────── PARTICIPANTS ────────────────────────────────

    /**
     * @notice Add a participant to an existing active escrow (admin only).
     */
    function addParticipant(bytes32 escrowId, address participant, string calldata role)
        external
        onlyOwner
        escrowExists(escrowId)
        escrowActive(escrowId)
    {
        require(participant != address(0),              "MultiPartyEscrow: zero address");
        require(!isParticipant[escrowId][participant],  "MultiPartyEscrow: already a participant");
        _addParticipant(escrowId, participant, role);
    }

    function _addParticipant(bytes32 escrowId, address wallet, string memory role) internal {
        require(wallet != address(0), "MultiPartyEscrow: zero address");
        Escrow storage e = escrows[escrowId];
        uint256 idx = e.participantCount;
        participants[escrowId][idx] = Participant({ wallet: wallet, role: role, isActive: true });
        isParticipant[escrowId][wallet] = true;
        e.participantCount++;
        emit ParticipantAdded(escrowId, wallet, role);
    }

    // ────────────────────────────── MILESTONES ────────────────────────────────

    /**
     * @notice Create a new milestone on an active escrow (admin only).
     * @param escrowId         Escrow identifier.
     * @param title            Short human-readable title.
     * @param description      Detailed description of deliverable.
     * @param amount           Amount released when this milestone is approved (token units).
     * @param requiredApprovals Number of distinct participant approvals required.
     */
    function createMilestone(
        bytes32 escrowId,
        string calldata title,
        string calldata description,
        uint256 amount,
        uint256 requiredApprovals
    ) external onlyOwner escrowExists(escrowId) escrowActive(escrowId) {
        require(amount > 0,             "MultiPartyEscrow: milestone amount must be > 0");
        require(requiredApprovals > 0,  "MultiPartyEscrow: at least one approval required");
        require(
            escrows[escrowId].participantCount >= requiredApprovals,
            "MultiPartyEscrow: requiredApprovals exceeds participant count"
        );

        Escrow storage e = escrows[escrowId];
        uint256 idx = e.milestoneCount;

        milestones[escrowId][idx] = Milestone({
            title:            title,
            description:      description,
            amount:           amount,
            requiredApprovals: requiredApprovals,
            approvalCount:    0,
            status:           MilestoneStatus.Pending
        });

        e.milestoneCount++;
        emit MilestoneCreated(escrowId, idx, title, amount);
    }

    /**
     * @notice Approve a milestone. Once the required threshold is reached funds are
     *         automatically transferred to the seller participant.
     * @param escrowId       Escrow identifier.
     * @param milestoneIndex Zero-based milestone index.
     */
    function approveMilestone(bytes32 escrowId, uint256 milestoneIndex)
        external
        nonReentrant
        escrowExists(escrowId)
        escrowActive(escrowId)
        onlyParticipant(escrowId)
    {
        Escrow storage e = escrows[escrowId];
        require(milestoneIndex < e.milestoneCount, "MultiPartyEscrow: invalid milestone index");

        Milestone storage m = milestones[escrowId][milestoneIndex];
        require(
            m.status == MilestoneStatus.Pending || m.status == MilestoneStatus.InProgress,
            "MultiPartyEscrow: milestone not approvable"
        );
        require(!hasApproved[escrowId][milestoneIndex][msg.sender], "MultiPartyEscrow: already approved");

        hasApproved[escrowId][milestoneIndex][msg.sender] = true;
        m.approvalCount++;
        m.status = MilestoneStatus.InProgress;

        emit MilestoneApproved(escrowId, milestoneIndex, msg.sender, m.approvalCount);

        if (m.approvalCount >= m.requiredApprovals) {
            _releaseMilestoneFunds(escrowId, milestoneIndex);
        }
    }

    // ─────────────────────────── INTERNAL RELEASE ────────────────────────────

    /**
     * @dev Transfers milestone funds to the seller participant and checks full completion.
     */
    function _releaseMilestoneFunds(bytes32 escrowId, uint256 milestoneIndex) internal {
        Escrow storage e   = escrows[escrowId];
        Milestone storage m = milestones[escrowId][milestoneIndex];

        m.status = MilestoneStatus.Approved;
        e.releasedAmount += m.amount;

        // Resolve seller: first participant whose role is "seller"; fallback to owner
        address payable recipient = payable(owner());
        for (uint256 i = 0; i < e.participantCount; i++) {
            if (keccak256(bytes(participants[escrowId][i].role)) == keccak256(bytes("seller"))) {
                recipient = payable(participants[escrowId][i].wallet);
                break;
            }
        }

        if (e.token == address(0)) {
            (bool ok,) = recipient.call{value: m.amount}("");
            require(ok, "MultiPartyEscrow: ETH transfer failed");
        } else {
            IERC20(e.token).safeTransfer(recipient, m.amount);
        }

        emit MilestoneCompleted(escrowId, milestoneIndex, m.amount, recipient);

        if (e.releasedAmount >= e.totalAmount) {
            e.status = EscrowStatus.Released;
            emit EscrowFullyReleased(escrowId);
        }
    }

    // ──────────────────────────── CANCELLATION ───────────────────────────────

    /**
     * @notice Cancel an active escrow and refund the unspent balance to the buyer.
     * @param escrowId Escrow identifier.
     * @param buyer    Wallet address to receive the refund.
     */
    function cancelEscrow(bytes32 escrowId, address buyer)
        external
        onlyOwner
        escrowExists(escrowId)
        nonReentrant
    {
        Escrow storage e = escrows[escrowId];
        require(e.status == EscrowStatus.Active, "MultiPartyEscrow: escrow not active");

        uint256 refundAmount = e.totalAmount - e.releasedAmount;
        e.status = EscrowStatus.Cancelled;

        if (refundAmount > 0) {
            if (e.token == address(0)) {
                (bool ok,) = payable(buyer).call{value: refundAmount}("");
                require(ok, "MultiPartyEscrow: refund transfer failed");
            } else {
                IERC20(e.token).safeTransfer(buyer, refundAmount);
            }
        }

        emit EscrowCancelled(escrowId, refundAmount);
    }

    // ─────────────────────────────── VIEWS ───────────────────────────────────

    /**
     * @notice Returns milestone details (without the inner approval mapping).
     */
    function getMilestoneInfo(bytes32 escrowId, uint256 milestoneIndex)
        external
        view
        returns (
            string memory title,
            string memory description,
            uint256 amount,
            uint256 requiredApprovals,
            uint256 approvalCount,
            MilestoneStatus status
        )
    {
        Milestone storage m = milestones[escrowId][milestoneIndex];
        return (m.title, m.description, m.amount, m.requiredApprovals, m.approvalCount, m.status);
    }

    /**
     * @notice Returns participant details at a given index.
     */
    function getParticipant(bytes32 escrowId, uint256 index)
        external
        view
        returns (address wallet, string memory role, bool active)
    {
        Participant storage p = participants[escrowId][index];
        return (p.wallet, p.role, p.isActive);
    }

    /**
     * @notice Check whether a specific address approved a specific milestone.
     */
    function didApprove(bytes32 escrowId, uint256 milestoneIndex, address approver)
        external
        view
        returns (bool)
    {
        return hasApproved[escrowId][milestoneIndex][approver];
    }

    // Allow contract to receive ETH for native-currency escrows
    receive() external payable {}
}
