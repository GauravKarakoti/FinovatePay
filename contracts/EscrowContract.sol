// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./ComplianceManager.sol";

contract EscrowContract is ReentrancyGuard {
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
    
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
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
        complianceManager = ComplianceManager(_complianceManager);
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

        // --- NEW: Lock the Produce NFT as Collateral ---
        // The seller must have approved the EscrowContract to spend this NFT beforehand.
        if (_rwaNftContract != address(0)) {
            IERC721(_rwaNftContract).transferFrom(_seller, address(this), _rwaTokenId); //
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
    
    function deposit(bytes32 _invoiceId, uint256 _amount) external nonReentrant onlyCompliant(msg.sender) {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.buyer == msg.sender, "Not the buyer");
        require(_amount == escrow.amount, "Incorrect amount");
        
        IERC20 token = IERC20(escrow.token);
        require(token.transferFrom(msg.sender, address(this), _amount), "Transfer failed");

        escrow.buyerConfirmed = true;
        emit DepositConfirmed(_invoiceId, msg.sender, _amount);
    }
    
    function confirmRelease(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(msg.sender == escrow.seller || msg.sender == escrow.buyer, "Not a party to this escrow");

        if (msg.sender == escrow.seller) {
            escrow.sellerConfirmed = true;
        } else {
            // Since the first require confirms the sender is either buyer or seller
            escrow.buyerConfirmed = true;
        }
        
        if (escrow.sellerConfirmed && escrow.buyerConfirmed) {
            _releaseFunds(_invoiceId);
        }
    }
    
    function raiseDispute(bytes32 _invoiceId) external {
        Escrow storage escrow = escrows[_invoiceId];
        require(msg.sender == escrow.seller || msg.sender == escrow.buyer, "Not a party to this escrow");
        require(!escrow.disputeRaised, "Dispute already raised");
        
        escrow.disputeRaised = true;
        emit DisputeRaised(_invoiceId, msg.sender);
    }
    
    function resolveDispute(bytes32 _invoiceId, bool _sellerWins) external onlyAdmin {
        Escrow storage escrow = escrows[_invoiceId];
        
        // CHECKS: Validate dispute state
        require(escrow.disputeRaised, "No dispute raised");
        
        // EFFECTS: Update all state variables BEFORE external calls
        escrow.disputeResolver = msg.sender;
        escrow.disputeRaised = false; // Mark dispute as resolved
        
        // Cache values for external calls to avoid multiple SLOAD operations
        address seller = escrow.seller;
        address buyer = escrow.buyer;
        uint256 amount = escrow.amount;
        address tokenAddress = escrow.token;
        address nftContract = escrow.rwaNftContract;
        uint256 nftTokenId = escrow.rwaTokenId;
        
        // Emit event BEFORE external interactions (part of Effects)
        emit DisputeResolved(_invoiceId, msg.sender, _sellerWins);
        
        // INTERACTIONS: Perform external calls LAST
        IERC20 token = IERC20(tokenAddress);

        if (_sellerWins) {
            // Seller wins: Get paid. Buyer gets the goods (NFT).
            require(token.transfer(seller, amount), "Transfer to seller failed");
            
            // Release NFT to Buyer (Ownership Transfer)
            if (nftContract != address(0)) {
                IERC721(nftContract).transferFrom(address(this), buyer, nftTokenId);
            }
        } else {
            // Buyer wins: Get refund. Seller gets the goods (NFT) back.
            require(token.transfer(buyer, amount), "Transfer to buyer failed");

            // Return NFT to Seller
            if (nftContract != address(0)) {
                IERC721(nftContract).transferFrom(address(this), seller, nftTokenId);
            }
        }
    }
    
    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        
        // EFFECTS: Cache values and emit event BEFORE external calls
        address seller = escrow.seller;
        address buyer = escrow.buyer;
        uint256 amount = escrow.amount;
        address tokenAddress = escrow.token;
        address nftContract = escrow.rwaNftContract;
        uint256 nftTokenId = escrow.rwaTokenId;
        
        // Mark escrow as completed (state update before interactions)
        escrow.sellerConfirmed = true;
        escrow.buyerConfirmed = true;
        
        // Emit event BEFORE external interactions
        emit EscrowReleased(_invoiceId, amount);
        
        // INTERACTIONS: Perform external calls LAST
        IERC20 token = IERC20(tokenAddress);
        
        // Transfer funds to Seller
        require(token.transfer(seller, amount), "Transfer failed");
        
        // Release RWA NFT to Buyer
        if (nftContract != address(0)) {
            IERC721(nftContract).transferFrom(address(this), buyer, nftTokenId);
        }
    }
    
    function expireEscrow(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(block.timestamp >= escrow.expiresAt, "Escrow not expired");
        require(!escrow.sellerConfirmed || !escrow.buyerConfirmed, "Already confirmed");
        
        // Return NFT to Seller (Default action on expiry)
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId); //
        }

        // Refund Buyer ONLY if they actually deposited
        if (escrow.buyerConfirmed) {
            IERC20 token = IERC20(escrow.token);
            require(token.transfer(escrow.buyer, escrow.amount), "Refund failed");
        }
    }
}