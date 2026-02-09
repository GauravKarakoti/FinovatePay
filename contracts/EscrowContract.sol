// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./ComplianceManager.sol";

contract EscrowContract is ReentrancyGuard, IERC721Receiver {
    
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
    
    ComplianceManager public complianceManager;
    address public admin;
    address public treasury;
    address public invoiceFactory;
    address public keeper;
    uint256 public feeBasisPoints;
    
    // --- Arbitrator Registry ---
    mapping(address => bool) public isArbitrator;
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
    event ComplianceManagerUpdated(address indexed newComplianceManager);
    event InvoiceFactoryUpdated(address indexed newInvoiceFactory);
    event ArbitratorAdded(address indexed arbitrator);
    event ArbitratorRemoved(address indexed arbitrator);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }
    
    modifier onlyManager() {
        require(managers[msg.sender], "Not manager");
        _;
    }
    

    // --- MINIMAL FIX: Allow admin OR arbitrators to resolve disputes ---
    modifier onlyCompliant(address _account) {
        require(!complianceManager.isFrozen(_account), "Account frozen");
        require(complianceManager.hasIdentity(_account), "Identity not verified (No SBT)");
        _;
    }

    modifier onlyEscrowParty(bytes32 _invoiceId) {
        Escrow storage escrow = escrows[_invoiceId];
        require(
            msg.sender == escrow.seller || 
            msg.sender == escrow.buyer || 
            msg.sender == admin || 
            msg.sender == invoiceFactory, 
            "Not authorized"
        );
        _;
    }
    
    modifier onlyAdminOrArbitrator() {
        require(msg.sender == admin || isArbitrator[msg.sender], "Not admin or arbitrator");
        _;
    }
    
    constructor(address _complianceManager) {
        require(_complianceManager != address(0), "Invalid compliance manager");
        admin = msg.sender;
        treasury = msg.sender;
        keeper = msg.sender;
        complianceManager = ComplianceManager(_complianceManager);
        // Admin is default arbitrator
        isArbitrator[msg.sender] = true;
        
        // Initialize multisig: admin is first manager, threshold starts at 1
        managers[msg.sender] = true;
        approvalThreshold = 1;
        emit ComplianceManagerUpdated(_complianceManager);
        emit ArbitratorAdded(msg.sender);
    }

    function setInvoiceFactory(address _invoiceFactory) external onlyAdmin {
        require(_invoiceFactory != address(0), "Invalid invoice factory");
        invoiceFactory = _invoiceFactory;
        emit InvoiceFactoryUpdated(_invoiceFactory);
    }
    
    // --- Multi-signature arbitrator management ---
    function proposeAddArbitrator(address _arbitrator) external {
        require(_arbitrator != address(0), "Invalid address");
        require(!arbitrators[_arbitrator], "Already an arbitrator");
        bytes32 proposalId = keccak256(abi.encodePacked("add", _arbitrator, block.number));
        require(proposals[proposalId].arbitrator == address(0), "Proposal already exists");
        proposals[proposalId] = Proposal(_arbitrator, true, 0, false);
        approved[proposalId][msg.sender] = true;
        proposals[proposalId].approvals++;
        emit ProposalCreated(proposalId, _arbitrator, true);
    }

    function proposeRemoveArbitrator(address _arbitrator) external {
        require(arbitrators[_arbitrator], "Not an arbitrator");
        bytes32 proposalId = keccak256(abi.encodePacked("remove", _arbitrator, block.number));
        require(proposals[proposalId].arbitrator == address(0), "Proposal already exists");
        proposals[proposalId] = Proposal(_arbitrator, false, 0, false);
        approved[proposalId][msg.sender] = true;
        proposals[proposalId].approvals++;
        emit ProposalCreated(proposalId, _arbitrator, false);
    }

    function approveProposal(bytes32 _proposalId) external {
        require(proposals[_proposalId].arbitrator != address(0), "Proposal does not exist");
        require(!proposals[_proposalId].executed, "Proposal already executed");
        require(!approved[_proposalId][msg.sender], "Already approved");
        approved[_proposalId][msg.sender] = true;
        proposals[_proposalId].approvals++;
        emit ProposalApproved(_proposalId, msg.sender);
    }

    function executeProposal(bytes32 _proposalId) external {
        Proposal storage proposal = proposals[_proposalId];
        require(proposal.arbitrator != address(0), "Proposal does not exist");
        require(!proposal.executed, "Proposal already executed");
        require(proposal.approvals >= threshold, "Not enough approvals");
        proposal.executed = true;
        if (proposal.isAdd) {
            _addArbitrator(proposal.arbitrator);
        } else {
            _removeArbitrator(proposal.arbitrator);
        }
        emit ProposalExecuted(_proposalId);
    }

    function _addArbitrator(address _arbitrator) internal {
    function setKeeper(address _keeper) external onlyAdmin {
        require(_keeper != address(0), "Invalid keeper");
        keeper = _keeper;
    }
    
    function addArbitrator(address _arbitrator) external onlyAdmin {
        require(_arbitrator != address(0), "Invalid arbitrator");
        arbitrators[_arbitrator] = true;
        emit ArbitratorAdded(_arbitrator);
    }
    
    function removeArbitrator(address _arbitrator) external onlyAdmin {
        arbitrators[_arbitrator] = false;
        emit ArbitratorRemoved(_arbitrator);
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

    // --- Internal Arbitrator Management ---
    function _addArbitrator(address arb) internal {
        require(arb != address(0), "Invalid address");
        require(!isArbitrator[arb], "Already arbitrator");
        isArbitrator[arb] = true;
    }

    function _removeArbitrator(address arb) internal {
        require(isArbitrator[arb], "Not arbitrator");
        isArbitrator[arb] = false;
    }

    // --- External Entry Points for Arbitrator Management ---
    function addArbitrator(address arb) external onlyAdmin {
        _addArbitrator(arb);
        emit ArbitratorAdded(arb);
    }

    function removeArbitrator(address arb) external onlyAdmin {
        _removeArbitrator(arb);
        emit ArbitratorRemoved(arb);
    }

    function createEscrow(
        bytes32 _invoiceId,
        address _seller,
        address _buyer,
        address _arbitrator,
        uint256 _amount,
        address _token,
        uint256 _duration,
        address _rwaNftContract,
        uint256 _rwaTokenId
    ) external onlyCompliant(msg.sender) returns (bool) {
        require(escrows[_invoiceId].seller == address(0), "Escrow already exists");
        require(_seller != address(0) && _buyer != address(0), "Invalid addresses");
        require(_amount > 0, "Amount must be > 0");
        require(_token != address(0), "Invalid token");
        require(msg.sender == _seller || msg.sender == _buyer || msg.sender == admin, "Must be party or admin");

        // Default arbitrator to admin if not provided
        address assignedArbitrator = _arbitrator == address(0) ? admin : _arbitrator;
        
        // Enforce approved arbitrator
        require(isArbitrator[assignedArbitrator], "Not approved arbitrator");

        escrows[_invoiceId] = Escrow({
            seller: _seller,
            buyer: _buyer,
            arbitrator: assignedArbitrator,
            amount: _amount,
            token: _token,
            status: EscrowStatus.Created,
            sellerConfirmed: false,
            buyerConfirmed: false,
            disputeRaised: false,
            disputeResolver: address(0),
            createdAt: block.timestamp,
            expiresAt: block.timestamp + _duration,
            rwaNftContract: _rwaNftContract,
            rwaTokenId: _rwaTokenId
        });

        // Lock the Produce NFT as Collateral
        if (_rwaNftContract != address(0)) {
            require(msg.sender == _seller || msg.sender == admin, "Only seller or admin can pledge RWA");
            IERC721(_rwaNftContract).transferFrom(_seller, address(this), _rwaTokenId);
        }

        emit EscrowCreated(_invoiceId, _seller, _buyer, _amount);
        return true;
    }

    function deposit(bytes32 _invoiceId, uint256 _amount) external nonReentrant onlyCompliant(msg.sender) {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.seller != address(0), "Escrow does not exist");
        require(escrow.buyer == msg.sender, "Not the buyer");
        require(escrow.status == EscrowStatus.Created, "Already deposited or invalid status");
        require(block.timestamp < escrow.expiresAt, "Escrow expired");
        require(_amount == escrow.amount, "Incorrect amount");
        
        IERC20 token = IERC20(escrow.token);
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "Transfer failed"
        );

        escrow.status = EscrowStatus.Funded;
        emit DepositConfirmed(_invoiceId, msg.sender, _amount);
    }
    
    function confirmRelease(bytes32 _invoiceId) external nonReentrant onlyEscrowParty(_invoiceId) {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded, "Not funded");
        
        if (msg.sender == escrow.seller) {
            require(!escrow.sellerConfirmed, "Already confirmed");
            escrow.sellerConfirmed = true;
        } else if (msg.sender == escrow.buyer) {
            require(!escrow.buyerConfirmed, "Already confirmed");
            escrow.buyerConfirmed = true;
        }
        
        // Auto-release if both confirmed
        if (escrow.sellerConfirmed && escrow.buyerConfirmed) {
            _releaseFunds(_invoiceId);
        }
    }
    
    function raiseDispute(bytes32 _invoiceId) external onlyEscrowParty(_invoiceId) {
        Escrow storage escrow = escrows[_invoiceId];
        require(msg.sender == escrow.seller || msg.sender == escrow.buyer, "Not a party");
        require(escrow.status == EscrowStatus.Funded, "Cannot dispute now");
        require(!escrow.disputeRaised, "Dispute already raised");
        
        escrow.disputeRaised = true;
        escrow.status = EscrowStatus.Disputed;
        emit DisputeRaised(_invoiceId, msg.sender);
    }
    
    function resolveDispute(bytes32 _invoiceId, bool _sellerWins) external nonReentrant onlyAdminOrArbitrator {
        Escrow storage escrow = escrows[_invoiceId];
        
        // Double protection for arbitrators
        require(isArbitrator[msg.sender], "Not approved arbitrator");
        require(msg.sender == escrow.arbitrator, "Not assigned arbitrator");
        
        require(escrow.status == EscrowStatus.Disputed, "No dispute raised");
        require(escrow.disputeRaised, "Dispute not active");
        
        escrow.disputeResolver = msg.sender;
        
        IERC20 token = IERC20(escrow.token);

        if (_sellerWins) {
            uint256 fee = (escrow.amount * feeBasisPoints) / 10000;
            uint256 sellerAmount = escrow.amount - fee;

            require(token.transfer(escrow.seller, sellerAmount), "Transfer to seller failed");
            if (fee > 0) {
                require(token.transfer(treasury, fee), "Transfer to treasury failed");
                emit FeeTaken(_invoiceId, fee);
            }
            
            // Release NFT to Buyer
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId);
            }
        } else {
            // Buyer wins: Refund Buyer, NFT back to Seller
            require(token.transfer(escrow.buyer, escrow.amount), "Refund failed");
            
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId);
            }
        }

        escrow.status = EscrowStatus.Released;
        emit DisputeResolved(_invoiceId, msg.sender, _sellerWins);
        delete escrows[_invoiceId];
    }
    
    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded, "Invalid status");
        
        escrow.status = EscrowStatus.Released;

        IERC20 token = IERC20(escrow.token);
        
        uint256 fee = (escrow.amount * feeBasisPoints) / 10000;
        uint256 sellerAmount = escrow.amount - fee;

        require(token.transfer(escrow.seller, sellerAmount), "Transfer to seller failed");

        if (fee > 0) {
            require(token.transfer(treasury, fee), "Transfer to treasury failed");
            emit FeeTaken(_invoiceId, fee);
        }
        
        // Release RWA NFT to Buyer
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId);
        }

        emit EscrowReleased(_invoiceId, escrow.amount);
        delete escrows[_invoiceId];
    }
    
    function expireEscrow(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.seller != address(0), "Escrow does not exist");
        require(
            msg.sender == escrow.seller || 
            msg.sender == escrow.buyer || 
            msg.sender == keeper || 
            msg.sender == admin, 
            "Not authorized"
        );
        require(block.timestamp >= escrow.expiresAt, "Escrow not expired");
        require(
            escrow.status == EscrowStatus.Created || escrow.status == EscrowStatus.Funded, 
            "Already finalized"
        );
        
        EscrowStatus oldStatus = escrow.status;
        escrow.status = EscrowStatus.Expired;

        // Return NFT to Seller
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId);
        }

        // Refund Buyer if they deposited
        if (oldStatus == EscrowStatus.Funded) {
            IERC20 token = IERC20(escrow.token);
            require(token.transfer(escrow.buyer, escrow.amount), "Refund failed");
        }

        emit EscrowExpired(_invoiceId);
    }

        emit EscrowCancelled(_invoiceId);
        delete escrows[_invoiceId];
    }
    
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
    
    // Emergency function to recover stuck tokens (admin only)
    function recoverTokens(address _token, uint256 _amount) external onlyAdmin {
        IERC20(_token).transfer(admin, _amount);
    }
    
    // Emergency function to recover stuck NFTs (admin only)
    function recoverNFT(address _nftContract, uint256 _tokenId) external onlyAdmin {
        IERC721(_nftContract).transferFrom(address(this), admin, _tokenId);
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