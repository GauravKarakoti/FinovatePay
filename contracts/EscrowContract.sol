// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./ComplianceManager.sol";

contract EscrowContract is ReentrancyGuard {
    enum State { Created, Deposited, Released, Disputed, Cancelled }

    struct Escrow {
        address seller;
        address buyer;
        address arbitrator;
        uint256 amount;
        address token; // The ERC20 payment token
        State state;
        address disputeResolver;
        uint256 createdAt;
        uint256 expiresAt;
        // --- NEW: RWA Collateral Link ---
        address rwaNftContract; // Address of the ProduceTracking contract
        uint256 rwaTokenId;     // The tokenId of the produce lot
    }
    
    mapping(bytes32 => Escrow) public escrows;
    ComplianceManager public complianceManager;
    address public admin;
    address public treasury;
    uint256 public feeBasisPoints;
    
    // ================= MULTISIG MANAGEMENT =================
    
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
    
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);
    event EscrowCancelled(bytes32 indexed invoiceId);
    event TreasuryUpdated(address indexed newTreasury);
    event FeeUpdated(uint256 newFeeBasisPoints);
    event FeeTaken(bytes32 indexed invoiceId, uint256 feeAmount);
    
    // Multisig events
    event ManagerAdded(address manager);
    event ManagerRemoved(address manager);
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
    
    modifier onlyCompliant(address _account) {
        require(!complianceManager.isFrozen(_account), "Account frozen");
        require(complianceManager.isKYCVerified(_account), "KYC not verified");
        require(complianceManager.hasIdentity(_account), "Identity not verified (No SBT)");
        _;
    }
    
    constructor(address _complianceManager) {
        admin = msg.sender;
        treasury = msg.sender;
        complianceManager = ComplianceManager(_complianceManager);
        
        // Initialize multisig: admin is first manager, threshold starts at 1
        managers[msg.sender] = true;
        approvalThreshold = 1;
    }
    
    function setTreasury(address _treasury) external onlyAdmin {
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setFeeBasisPoints(uint256 _feeBasisPoints) external onlyAdmin {
        require(_feeBasisPoints <= 1000, "Fee too high"); // Max 10%
        feeBasisPoints = _feeBasisPoints;
        emit FeeUpdated(_feeBasisPoints);
    }

    function createEscrow(
        bytes32 _invoiceId,
        address _seller,
        address _buyer,
        address _arbitrator,
        uint256 _amount,
        address _token,
        uint256 _duration,
        // --- NEW: RWA Parameters ---
        address _rwaNftContract,
        uint256 _rwaTokenId
    ) external onlyCompliant(msg.sender) returns (bool) {
        require(escrows[_invoiceId].seller == address(0), "Escrow already exists");
        require(msg.sender == _seller || msg.sender == _buyer, "Must be party");

        // Default arbitrator to admin if not provided
        address assignedArbitrator = _arbitrator == address(0) ? admin : _arbitrator;

        escrows[_invoiceId] = Escrow({
            seller: _seller,
            buyer: _buyer,
            arbitrator: assignedArbitrator,
            amount: _amount,
            token: _token,
            state: State.Created,
            disputeResolver: address(0),
            createdAt: block.timestamp,
            expiresAt: block.timestamp + _duration,
            rwaNftContract: _rwaNftContract,
            rwaTokenId: _rwaTokenId
        });

        // --- NEW: Lock the Produce NFT as Collateral ---
        // The seller must have approved the EscrowContract to spend this NFT beforehand.
        if (_rwaNftContract != address(0)) {
            require(msg.sender == _seller, "Only seller can pledge RWA");
            IERC721(_rwaNftContract).transferFrom(_seller, address(this), _rwaTokenId);
        }

        emit EscrowCreated(_invoiceId, _seller, _buyer, _amount);
        return true;
    }
    
    function deposit(bytes32 _invoiceId, uint256 _amount) external nonReentrant onlyCompliant(msg.sender) {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.buyer == msg.sender, "Not the buyer");
        require(escrow.state == State.Created, "Already deposited or invalid state");
        require(_amount == escrow.amount, "Incorrect amount");
        
        IERC20 token = IERC20(escrow.token);
        require(token.transferFrom(msg.sender, address(this), _amount), "Transfer failed");

        escrow.state = State.Deposited;
        emit DepositConfirmed(_invoiceId, msg.sender, _amount);
    }
    
    function confirmRelease(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(msg.sender == escrow.buyer, "Only buyer can confirm release");
        require(escrow.state == State.Deposited, "Not deposited");

        _releaseFunds(_invoiceId);
    }
    
    function raiseDispute(bytes32 _invoiceId) external {
        Escrow storage escrow = escrows[_invoiceId];
        require(msg.sender == escrow.seller || msg.sender == escrow.buyer, "Not a party to this escrow");
        require(escrow.state == State.Deposited, "Cannot dispute now");
        
        escrow.state = State.Disputed;
        emit DisputeRaised(_invoiceId, msg.sender);
    }
    
    function resolveDispute(bytes32 _invoiceId, bool _sellerWins) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(msg.sender == escrow.arbitrator, "Not arbitrator");
        require(escrow.state == State.Disputed, "No dispute raised");
        
        escrow.disputeResolver = msg.sender;
        escrow.state = State.Released; // Update state before interactions

        IERC20 token = IERC20(escrow.token);

        if (_sellerWins) {
            // Seller wins: Get paid (minus fee). Buyer gets the goods (NFT).
            uint256 fee = (escrow.amount * feeBasisPoints) / 10000;
            uint256 sellerAmount = escrow.amount - fee;

            require(token.transfer(escrow.seller, sellerAmount), "Transfer to seller failed");
            if (fee > 0) {
                require(token.transfer(treasury, fee), "Transfer to treasury failed");
                emit FeeTaken(_invoiceId, fee);
            }
            
            // Release NFT to Buyer (Ownership Transfer)
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId);
            }
        } else {
            // Buyer wins: Get refund. Seller gets the goods (NFT) back.
            require(token.transfer(escrow.buyer, escrow.amount), "Transfer to buyer failed");

            // Return NFT to Seller
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId);
            }
        }
        
        emit DisputeResolved(_invoiceId, msg.sender, _sellerWins);
    }
    
    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        escrow.state = State.Released; // Checks-Effects-Interactions

        IERC20 token = IERC20(escrow.token);
        
        uint256 fee = (escrow.amount * feeBasisPoints) / 10000;
        uint256 sellerAmount = escrow.amount - fee;

        // Transfer funds to Seller
        require(token.transfer(escrow.seller, sellerAmount), "Transfer to seller failed");

        // Transfer fee to Treasury
        if (fee > 0) {
            require(token.transfer(treasury, fee), "Transfer to treasury failed");
            emit FeeTaken(_invoiceId, fee);
        }
        
        // --- NEW: Release RWA NFT to Buyer ---
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId);
        }
        
        emit EscrowReleased(_invoiceId, escrow.amount);
    }
    
    function expireEscrow(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(block.timestamp >= escrow.expiresAt, "Escrow not expired");
        State oldState = escrow.state;
        require(oldState == State.Created || oldState == State.Deposited, "Already finalized");
        
        escrow.state = State.Cancelled; // Checks-Effects-Interactions

        // Return NFT to Seller (Default action on expiry)
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId);
        }

        // Refund Buyer ONLY if they actually deposited
        if (oldState == State.Deposited) {
            IERC20 token = IERC20(escrow.token);
            require(token.transfer(escrow.buyer, escrow.amount), "Refund failed");
        }

        emit EscrowCancelled(_invoiceId);
    }
    
    // ================= MULTISIG FUNCTIONS =================
    
    /**
     * @notice Create a proposal to add or remove an arbitrator (manager)
     * @param _arb The arbitrator address to add or remove
     * @param _add True to add, false to remove
     * @return proposalId The ID of the created proposal
     */
    function proposeArbitrator(address _arb, bool _add)
        external
        onlyManager
        returns (uint256 proposalId)
    {
        require(_arb != address(0), "Invalid address");
        
        proposalId = proposalCount++;
        
        Proposal storage p = proposals[proposalId];
        p.arbitrator = _arb;
        p.action = _add ? Action.AddArbitrator : Action.RemoveArbitrator;
        
        emit ProposalCreated(proposalId, _arb, p.action);
    }
    
    /**
     * @notice Approve an existing proposal
     * @param _id The proposal ID to approve
     */
    function approveProposal(uint256 _id)
        external
        onlyManager
    {
        Proposal storage p = proposals[_id];
        
        require(!p.executed, "Already executed");
        require(!p.approvedBy[msg.sender], "Already approved");
        
        p.approvedBy[msg.sender] = true;
        p.approvals++;
        
        emit ProposalApproved(_id, msg.sender);
    }
    
    /**
     * @notice Execute a proposal once threshold is reached
     * @param _id The proposal ID to execute
     */
    function executeProposal(uint256 _id)
        external
        onlyManager
    {
        Proposal storage p = proposals[_id];
        
        require(!p.executed, "Already executed");
        require(p.approvals >= approvalThreshold, "Not enough approvals");
        
        p.executed = true;
        
        if (p.action == Action.AddArbitrator) {
            managers[p.arbitrator] = true;
            emit ManagerAdded(p.arbitrator);
        } else {
            managers[p.arbitrator] = false;
            emit ManagerRemoved(p.arbitrator);
        }
        
        emit ProposalExecuted(_id);
    }
    
    /**
     * @notice Update the required approval threshold (admin only)
     * @param _t The new threshold value
     */
    function setApprovalThreshold(uint256 _t) external onlyAdmin {
        require(_t > 0, "Threshold must be > 0");
        approvalThreshold = _t;
    }
}