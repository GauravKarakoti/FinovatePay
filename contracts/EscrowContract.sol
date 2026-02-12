// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract EscrowContract {
    // --- State Variables for Multi-Sig ---
    mapping(address => bool) public isManager;
    address[] public managers;
    uint public threshold;

    struct Proposal {
        address targetArbitrator;
        bool isAddition; // true = add, false = remove
        uint approvalCount;
        bool executed;
    }

    mapping(uint => Proposal) public proposals;
    mapping(uint => mapping(address => bool)) public hasApproved;
    uint public proposalCount;

    // --- Existing state for arbitrators ---
    mapping(address => bool) public isArbitrator;

    // --- Events ---
    event ArbitratorProposed(uint indexed proposalId, address indexed target, bool isAddition);
    event ProposalApproved(uint indexed proposalId, address indexed manager);
    event ProposalExecuted(uint indexed proposalId, address indexed target, bool isAddition);
    event ArbitratorAdded(address indexed arbitrator);
    event ArbitratorRemoved(address indexed arbitrator);

    // --- Modifiers ---
    modifier onlyManager() {
        require(isManager[msg.sender], "Not a manager");
        _;
    }

    modifier proposalExists(uint _proposalId) {
        require(_proposalId < proposalCount, "Proposal does not exist");
        _;
    }

    modifier notExecuted(uint _proposalId) {
        require(!proposals[_proposalId].executed, "Proposal already executed");
        _;
    }

    modifier notApproved(uint _proposalId) {
        require(!hasApproved[_proposalId][msg.sender], "Already approved");
        _;
    }

    // --- Constructor ---
    constructor(address[] memory _managers, uint _threshold) {
        require(_managers.length > 0, "Managers required");
        require(_threshold > 0 && _threshold <= _managers.length, "Invalid threshold");

        for (uint i = 0; i < _managers.length; i++) {
            address manager = _managers[i];
            require(manager != address(0), "Invalid manager address");
            require(!isManager[manager], "Duplicate manager");
            
            isManager[manager] = true;
            managers.push(manager);
        }
        threshold = _threshold;
    }

    // --- Multi-Sig Proposal Functions ---

    function proposeAddArbitrator(address _arbitrator) external onlyManager returns (uint) {
        require(!isArbitrator[_arbitrator], "Already an arbitrator");
        return _createProposal(_arbitrator, true);
    }

    function proposeRemoveArbitrator(address _arbitrator) external onlyManager returns (uint) {
        require(isArbitrator[_arbitrator], "Not an arbitrator");
        return _createProposal(_arbitrator, false);
    }

    function _createProposal(address _target, bool _isAddition) private returns (uint) {
        uint proposalId = proposalCount++;
        
        Proposal storage newProposal = proposals[proposalId];
        newProposal.targetArbitrator = _target;
        newProposal.isAddition = _isAddition;
        newProposal.approvalCount = 0;
        newProposal.executed = false;

        emit ArbitratorProposed(proposalId, _target, _isAddition);
        return proposalId;
    }

    // --- Approval and Execution ---

    function approveProposal(uint _proposalId) 
        external 
        onlyManager 
        proposalExists(_proposalId) 
        notExecuted(_proposalId) 
        notApproved(_proposalId) 
    {
        hasApproved[_proposalId][msg.sender] = true;
        proposals[_proposalId].approvalCount += 1;

        emit ProposalApproved(_proposalId, msg.sender);
    }

    function executeProposal(uint _proposalId) 
        external 
        onlyManager 
        proposalExists(_proposalId) 
        notExecuted(_proposalId) 
    {
        Proposal storage proposal = proposals[_proposalId];
        require(proposal.approvalCount >= threshold, "Threshold not met");

        proposal.executed = true;

        if (proposal.isAddition) {
            _addArbitrator(proposal.targetArbitrator);
        } else {
            _removeArbitrator(proposal.targetArbitrator);
        }

        emit ProposalExecuted(_proposalId, proposal.targetArbitrator, proposal.isAddition);
    }

    // --- Internal Execution Functions ---
    // Refactored to internal so they can ONLY be triggered by executed proposals

    function _addArbitrator(address _arbitrator) internal {
        isArbitrator[_arbitrator] = true;
        emit ArbitratorAdded(_arbitrator);
    }


    function _removeArbitrator(address _arbitrator) internal {
        arbitrators[_arbitrator] = false;
    }

    function setThreshold(uint256 _threshold) external onlyAdmin {
        require(_threshold > 0 && _threshold <= managers.length, "Invalid threshold");
        threshold = _threshold;
    }

    function addManager(address _manager) external onlyAdmin {
        require(_manager != address(0), "Invalid address");
        require(!isManager(_manager), "Already a manager");
        managers.push(_manager);
    }

    function removeManager(address _manager) external onlyAdmin {
        require(isManager(_manager), "Not a manager");
        require(managers.length > 1, "Cannot remove last manager");
        for (uint256 i = 0; i < managers.length; i++) {
            if (managers[i] == _manager) {
                managers[i] = managers[managers.length - 1];
                managers.pop();
                break;
            }
        }
    }

    function isManager(address _account) public view returns (bool) {
        for (uint256 i = 0; i < managers.length; i++) {
            if (managers[i] == _account) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * @notice Initializes escrow and locks the RWA NFT collateral.
     */
    function createEscrow(
        bytes32 _invoiceId,
        address _seller,
        address _buyer,
        uint256 _amount,
        address _token,
        uint256 _duration,
        address _rwaNftContract,
        uint256 _rwaTokenId
    ) external onlyAdmin returns (bool) {
        require(escrows[_invoiceId].seller == address(0), "Escrow already exists");

        // Lock the Produce NFT as Collateral
        if (_rwaNftContract != address(0)) {
            // Requirement: Seller must have approved this contract for the NFT
            IERC721(_rwaNftContract).transferFrom(_seller, address(this), _rwaTokenId);
        }

        escrows[_invoiceId] = Escrow({
            seller: _seller,
            buyer: _buyer,
            status: EscrowStatus.Created,
            amount: _amount,
            token: _token,
            sellerConfirmed: false,
            buyerConfirmed: false,
            disputeRaised: false,
            disputeResolver: address(0),
            createdAt: block.timestamp,
            expiresAt: block.timestamp + _duration,
            rwaNftContract: _rwaNftContract,
            rwaTokenId: _rwaTokenId
        });

        emit EscrowCreated(_invoiceId, _seller, _buyer, _amount);
        return true;
    }
    
    /**
     * @notice Buyer deposits funds. Prevents deposit if escrow has expired.
     */
    function deposit(bytes32 _invoiceId, uint256 _amount) external nonReentrant onlyCompliant(msg.sender) {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Created, "Escrow not active");
        require(escrow.seller != address(0), "Escrow does not exist");
        require(escrow.buyer == msg.sender, "Not the buyer");
        require(!escrow.buyerConfirmed, "Already funded");
        
        // Prevents deposit after expiry to avoid locking funds in a dead contract
        require(block.timestamp < escrow.expiresAt, "Escrow expired");
        require(_amount == escrow.amount, "Incorrect amount");
        
        IERC20 token = IERC20(escrow.token);
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "Transfer failed"
        );

        escrow.buyerConfirmed = true;
        escrow.status = EscrowStatus.Funded;
        emit DepositConfirmed(_invoiceId, msg.sender, _amount);
    }
    
    /**
     * @notice Both parties must confirm to release funds/NFT.
     */
    function confirmRelease(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded, "Escrow not funded");
        require(
            msg.sender == escrow.seller || msg.sender == escrow.buyer,
            "Not a party to this escrow"
        );

        if (msg.sender == escrow.seller) {
            escrow.sellerConfirmed = true;
        } else {
            escrow.buyerConfirmed = true;
        }
        
        if (escrow.sellerConfirmed && escrow.buyerConfirmed) {
            _releaseFunds(_invoiceId);
        }
    }
    
    function raiseDispute(bytes32 _invoiceId) external {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded, "Cannot dispute now");
        require(
            msg.sender == escrow.seller || msg.sender == escrow.buyer,
            "Not a party to this escrow"
        );
        require(!escrow.disputeRaised, "Dispute already raised");
        
        escrow.disputeRaised = true;
        escrow.status = EscrowStatus.Disputed;
        emit DisputeRaised(_invoiceId, msg.sender);
    }
    
    /**
     * @notice Admin resolves the dispute and distributes RWA/Funds accordingly.
     */
    function resolveDispute(bytes32 _invoiceId, bool _sellerWins) external onlyAdmin {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Disputed, "No active dispute");
        require(escrow.disputeRaised, "No dispute raised");
        
        escrow.disputeResolver = msg.sender;
        IERC20 token = IERC20(escrow.token);

        if (_sellerWins) {
            // Seller wins: Funds to Seller, NFT to Buyer
            require(token.transfer(escrow.seller, escrow.amount), "Transfer failed");
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId);
            }
        } else {
            // Buyer wins: Refund Buyer, NFT back to Seller
            if (escrow.buyerConfirmed) {
                require(token.transfer(escrow.buyer, escrow.amount), "Transfer failed");
            }
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId);
            }
        }

        escrow.status = EscrowStatus.Released;
        emit DisputeResolved(_invoiceId, msg.sender, _sellerWins);
        delete escrows[_invoiceId]; // Cleanup state after resolution
    }
    
    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded, "Escrow not funded");
        IERC20 token = IERC20(escrow.token);
        
        require(
            token.transfer(escrow.seller, escrow.amount),
            "Transfer failed"
        );
        
        // Release RWA NFT to Buyer
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId);
        }

        escrow.status = EscrowStatus.Released;
        emit EscrowReleased(_invoiceId, escrow.amount);
        delete escrows[_invoiceId];
    }
    
    /**
     * @notice Allows cleanup/refund if the transaction never completed within the timeframe.
     */
    function expireEscrow(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded || escrow.status == EscrowStatus.Created, "Escrow not active");
        require(msg.sender == escrow.seller || msg.sender == escrow.buyer || msg.sender == keeper, "Not authorized to expire escrow");
        require(block.timestamp >= escrow.expiresAt, "Escrow not expired");
        require(!(escrow.sellerConfirmed && escrow.buyerConfirmed), "Already confirmed");
        
        // Return NFT to Seller
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId);
        }

        // Refund Buyer if they deposited
        if (escrow.buyerConfirmed) {
            IERC20 token = IERC20(escrow.token);
            require(
                token.transfer(escrow.buyer, escrow.amount),
                "Refund failed"
            );
        }

        escrow.status = EscrowStatus.Expired;
        delete escrows[_invoiceId];
    }

    // --- ERC721 Receiver ---
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
