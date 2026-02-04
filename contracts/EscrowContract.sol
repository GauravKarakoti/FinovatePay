// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./ComplianceManager.sol";

contract EscrowContract is ReentrancyGuard, IERC721Receiver {
    struct Escrow {
        address seller;
        address buyer;
        uint256 amount;
        address token; // The ERC20 payment token
        bool sellerConfirmed;
        bool buyerConfirmed;
        bool disputeRaised;
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
    address public keeper;
    
    // --- MINIMAL FIX: Add arbitrator support ---
    mapping(address => bool) public arbitrators;

    // --- Multi-signature for arbitrator management ---
    address[] public managers;
    uint256 public threshold;
    struct Proposal {
        address arbitrator;
        bool isAdd;
        uint256 approvals;
        bool executed;
    }
    mapping(bytes32 => Proposal) public proposals;
    mapping(bytes32 => mapping(address => bool)) public approved;
    
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);
    event ComplianceManagerUpdated(address indexed newComplianceManager);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }
    
    // --- MINIMAL FIX: Allow admin OR arbitrators to resolve disputes ---
    modifier onlyAdminOrArbitrator() {
        require(msg.sender == admin || arbitrators[msg.sender], "Not authorized");
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
        keeper = msg.sender;
        complianceManager = ComplianceManager(_complianceManager);
        managers.push(msg.sender);
        threshold = 1;
    }

    function setComplianceManager(address _complianceManager) external onlyAdmin {
        require(_complianceManager != address(0), "Invalid compliance manager");
        complianceManager = ComplianceManager(_complianceManager);
        emit ComplianceManagerUpdated(_complianceManager);
    }
    
    // --- Multi-signature arbitrator management ---
    function proposeAddArbitrator(address _arbitrator) external {
        require(_arbitrator != address(0), "Invalid address");
        require(!arbitrators[_arbitrator], "Already an arbitrator");
        bytes32 proposalId = keccak256(abi.encodePacked("add", _arbitrator, block.timestamp));
        require(proposals[proposalId].arbitrator == address(0), "Proposal already exists");
        proposals[proposalId] = Proposal(_arbitrator, true, 0, false);
        approved[proposalId][msg.sender] = true;
        proposals[proposalId].approvals++;
        emit ProposalCreated(proposalId, _arbitrator, true);
    }

    function proposeRemoveArbitrator(address _arbitrator) external {
        require(arbitrators[_arbitrator], "Not an arbitrator");
        bytes32 proposalId = keccak256(abi.encodePacked("remove", _arbitrator, block.timestamp));
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
        arbitrators[_arbitrator] = true;
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
    
    function createEscrow(
        bytes32 _invoiceId,
        address _seller,
        address _buyer,
        uint256 _amount,
        address _token,
        uint256 _duration,
        // --- NEW: RWA Parameters ---
        address _rwaNftContract,
        uint256 _rwaTokenId
    ) external onlyAdmin returns (bool) {
        require(escrows[_invoiceId].seller == address(0), "Escrow already exists");

        // --- Lock the Produce NFT as Collateral ---
        // The seller must have approved the EscrowContract beforehand.
        if (_rwaNftContract != address(0)) {
            IERC721(_rwaNftContract).safeTransferFrom(
                _seller,
                address(this),
                _rwaTokenId
            );
        }

        escrows[_invoiceId] = Escrow({
            seller: _seller,
            buyer: _buyer,
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
    
    function deposit(bytes32 _invoiceId, uint256 _amount)
        external
        nonReentrant
        onlyCompliant(msg.sender)
    {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.buyer == msg.sender, "Not the buyer");
        require(_amount == escrow.amount, "Incorrect amount");
        
        IERC20 token = IERC20(escrow.token);
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "Transfer failed"
        );

        escrow.buyerConfirmed = true;
        emit DepositConfirmed(_invoiceId, msg.sender, _amount);
    }
    
    function confirmRelease(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
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
        require(
            msg.sender == escrow.seller || msg.sender == escrow.buyer,
            "Not a party to this escrow"
        );
        require(!escrow.disputeRaised, "Dispute already raised");
        
        escrow.disputeRaised = true;
        emit DisputeRaised(_invoiceId, msg.sender);
    }
    
    function resolveDispute(bytes32 _invoiceId, bool _sellerWins) external onlyAdminOrArbitrator {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.disputeRaised, "No dispute raised");
        
        escrow.disputeResolver = msg.sender;
        IERC20 token = IERC20(escrow.token);

        if (_sellerWins) {
            // Seller wins: Get paid. Buyer gets the goods (NFT).
            require(
                token.transfer(escrow.seller, escrow.amount),
                "Transfer to seller failed"
            );
            
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).safeTransferFrom(
                    address(this),
                    escrow.buyer,
                    escrow.rwaTokenId
                );
            }
        } else {
            // Buyer wins: Refund buyer. Seller gets NFT back.
            require(
                token.transfer(escrow.buyer, escrow.amount),
                "Transfer to buyer failed"
            );

            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).safeTransferFrom(
                    address(this),
                    escrow.seller,
                    escrow.rwaTokenId
                );
            }
        }
        
        emit DisputeResolved(_invoiceId, msg.sender, _sellerWins);
    }
    
    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        IERC20 token = IERC20(escrow.token);
        
        require(
            token.transfer(escrow.seller, escrow.amount),
            "Transfer failed"
        );
        
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).safeTransferFrom(
                address(this),
                escrow.buyer,
                escrow.rwaTokenId
            );
        }
        
        emit EscrowReleased(_invoiceId, escrow.amount);
    }
    
    function expireEscrow(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(msg.sender == escrow.seller || msg.sender == escrow.buyer || msg.sender == keeper, "Not authorized to expire escrow");
        require(block.timestamp >= escrow.expiresAt, "Escrow not expired");
        require(
            !escrow.sellerConfirmed || !escrow.buyerConfirmed,
            "Already confirmed"
        );
        
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).safeTransferFrom(
                address(this),
                escrow.seller,
                escrow.rwaTokenId
            );
        }

        if (escrow.buyerConfirmed) {
            IERC20 token = IERC20(escrow.token);
            require(
                token.transfer(escrow.buyer, escrow.amount),
                "Refund failed"
            );
        }
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
