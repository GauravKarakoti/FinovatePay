// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./ComplianceManager.sol";

contract EscrowContract is ReentrancyGuard, IERC721Receiver, EIP712 {
    
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
    address public invoiceFactory;
    address public keeper;
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
    
    // ================= GASLESS META TX =================
    
    mapping(address => uint256) public nonces;
    
    bytes32 private constant META_TX_TYPEHASH =
        keccak256("MetaTx(address user,bytes functionData,uint256 nonce)");
    
    // ================= EVENTS =================
    
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);
    event EscrowCancelled(bytes32 indexed invoiceId);
    event EscrowExpired(bytes32 indexed invoiceId);
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
    event ManagerAdded(address manager);
    event ManagerRemoved(address manager);
    event ProposalCreated(uint256 id, address arbitrator, Action action);
    event ProposalApproved(uint256 id, address manager);
    event ProposalExecuted(uint256 id);
    event MetaTxExecuted(address indexed user, bytes functionData, uint256 nonce);

    // ================= MODIFIERS =================

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
        require(
            msg.sender == admin || 
            arbitrators[msg.sender] || 
            managers[msg.sender], 
            "Not authorized"
        );
        _;
    }

    // ================= CONSTRUCTOR =================

    constructor(address _complianceManager)
        EIP712("FinovatePay", "1")
    {
        require(_complianceManager != address(0), "Invalid compliance manager");
        admin = msg.sender;
        treasury = msg.sender;
        keeper = msg.sender;
        complianceManager = ComplianceManager(_complianceManager);
        
        // Initialize multisig: admin is first manager, threshold starts at 1
        managers[msg.sender] = true;
        approvalThreshold = 1;
        emit ComplianceManagerUpdated(_complianceManager);
    }

    // ================= ADMIN FUNCTIONS =================

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

    // ================= META-TX HELPER =================

    /**
     * @notice Extract real sender from meta-transaction or return msg.sender
     * @return sender The actual user address (not the relayer)
     */
    function _msgSenderMeta() internal view returns (address sender) {
        if (msg.sender == address(this)) {
            // Meta-transaction: extract user address appended to calldata
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }

    // ================= CORE FUNCTIONS =================

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
    ) external onlyCompliant(_msgSenderMeta()) returns (bool) {
        address realSender = _msgSenderMeta();
        
        require(escrows[_invoiceId].seller == address(0), "Escrow already exists");
        require(_seller != address(0) && _buyer != address(0), "Invalid addresses");
        require(_amount > 0, "Amount must be > 0");
        require(_token != address(0), "Invalid token");
        require(realSender == _seller || realSender == _buyer || realSender == admin, "Must be party or admin");

        // Default arbitrator to admin if not provided
        address assignedArbitrator = _arbitrator == address(0) ? admin : _arbitrator;

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
            require(realSender == _seller || realSender == admin, "Only seller or admin can pledge RWA");
            IERC721(_rwaNftContract).transferFrom(_seller, address(this), _rwaTokenId);
        }

        emit EscrowCreated(_invoiceId, _seller, _buyer, _amount);
        return true;
    }

    function deposit(bytes32 _invoiceId, uint256 _amount) external nonReentrant onlyCompliant(_msgSenderMeta()) {
        address realSender = _msgSenderMeta();
        Escrow storage escrow = escrows[_invoiceId];
        
        require(escrow.seller != address(0), "Escrow does not exist");
        require(escrow.buyer == realSender, "Not the buyer");
        require(escrow.status == EscrowStatus.Created, "Already deposited or invalid status");
        require(block.timestamp < escrow.expiresAt, "Escrow expired");
        require(_amount == escrow.amount, "Incorrect amount");
        
        IERC20 token = IERC20(escrow.token);
        require(token.transferFrom(realSender, address(this), _amount), "Transfer failed");

        escrow.status = EscrowStatus.Funded;
        emit DepositConfirmed(_invoiceId, realSender, _amount);
    }
    
    function confirmRelease(bytes32 _invoiceId) external nonReentrant onlyEscrowParty(_invoiceId) {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded, "Not funded");
        
        address realSender = _msgSenderMeta();
        
        if (realSender == escrow.seller) {
            require(!escrow.sellerConfirmed, "Already confirmed");
            escrow.sellerConfirmed = true;
        } else if (realSender == escrow.buyer) {
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
        require(escrow.status == EscrowStatus.Funded, "Cannot dispute now");
        require(!escrow.disputeRaised, "Dispute already raised");
        
        escrow.disputeRaised = true;
        escrow.status = EscrowStatus.Disputed;
        emit DisputeRaised(_invoiceId, _msgSenderMeta());
    }
    
    function resolveDispute(bytes32 _invoiceId, bool _sellerWins) external nonReentrant onlyAdminOrArbitrator {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Disputed, "No dispute raised");
        require(escrow.disputeRaised, "Dispute not active");
        
        escrow.disputeResolver = msg.sender;
        escrow.status = EscrowStatus.Released;
        
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
        
        // Auto-approve proposer for better UX
        p.approvedBy[msg.sender] = true;
        p.approvals = 1;
        
        emit ProposalCreated(proposalId, _arb, p.action);
    }
    
    function approveProposal(uint256 _id)
        external
        onlyManager
    {
        require(_id < proposalCount, "Invalid proposal");
        
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
        require(_id < proposalCount, "Invalid proposal");
        
        Proposal storage p = proposals[_id];
        
        require(!p.executed, "Already executed");
        require(p.approvals >= approvalThreshold, "Not enough approvals");
        
        p.executed = true;
        
        if (p.action == Action.AddArbitrator) {
            managers[p.arbitrator] = true;
            arbitrators[p.arbitrator] = true;
            emit ManagerAdded(p.arbitrator);
            emit ArbitratorAdded(p.arbitrator);
        } else {
            managers[p.arbitrator] = false;
            arbitrators[p.arbitrator] = false;
            emit ManagerRemoved(p.arbitrator);
            emit ArbitratorRemoved(p.arbitrator);
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
    
    // ================= GASLESS META TX FUNCTION =================
    
    function executeMetaTx(
        address user,
        bytes calldata functionData,
        bytes calldata signature
    ) external payable nonReentrant {
        
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(
                META_TX_TYPEHASH,
                user,
                keccak256(functionData),
                nonces[user]++
            ))
        );

        address signer = ECDSA.recover(digest, signature);
        require(signer == user, "Invalid signature");

        // Append user address to calldata for _msgSenderMeta() extraction
        (bool success, ) = address(this).call(
            abi.encodePacked(functionData, user)
        );
        require(success, "Meta tx failed");
        
        emit MetaTxExecuted(user, functionData, nonces[user] - 1);
    }
}