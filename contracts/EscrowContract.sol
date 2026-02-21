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
        uint256 feeAmount;      // Platform fee amount
    }
    
    mapping(bytes32 => Escrow) public escrows;
    ComplianceManager public complianceManager;
    address public admin;
    address public treasury;        // Platform treasury address for fee collection
    uint256 public feePercentage;   // Fee percentage in basis points (e.g., 50 = 0.5%)
    
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);
    event FeeCollected(bytes32 indexed invoiceId, uint256 feeAmount, address treasury);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event FeePercentageUpdated(uint256 oldFee, uint256 newFee);

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
        treasury = msg.sender; // Default treasury to admin
        feePercentage = 50;    // Default 0.5% fee (50 basis points)
    }
    
    /**
     * @notice Set the treasury address for fee collection
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyAdmin {
        require(_treasury != address(0), "Treasury cannot be zero address");
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }
    
    /**
     * @notice Set the fee percentage in basis points
     * @param _feePercentage Fee in basis points (e.g., 50 = 0.5%, 100 = 1%)
     */
    function setFeePercentage(uint256 _feePercentage) external onlyAdmin {
        require(_feePercentage <= 1000, "Fee cannot exceed 10%"); // Max 10% fee
        uint256 oldFee = feePercentage;
        feePercentage = _feePercentage;
        emit FeePercentageUpdated(oldFee, _feePercentage);
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

        // Calculate fee amount
        uint256 calculatedFee = (_amount * feePercentage) / 10000; // Basis points calculation

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
            rwaTokenId: _rwaTokenId,
            feeAmount: calculatedFee
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
        Escrow storage e = escrows[_invoiceId];
        require(e.disputeRaised, "No dispute raised");
        
        e.disputeResolver = msg.sender;
        IERC20 token = IERC20(e.token);

        // Calculate amounts
        uint256 fee = e.feeAmount;
        uint256 amountAfterFee = e.amount - fee;

        // Collect platform fee regardless of dispute outcome
        if (fee > 0 && treasury != address(0)) {
            require(token.transfer(treasury, fee), "Fee transfer failed");
            emit FeeCollected(_invoiceId, fee, treasury);
        }

        if (_sellerWins) {
            // Seller wins: Get paid (minus fee). Buyer gets the goods (NFT).
            require(token.transfer(e.seller, amountAfterFee), "Transfer to seller failed");
            
            // Release NFT to Buyer (Ownership Transfer)
            if (e.rwaNftContract != address(0)) {
                IERC721(e.rwaNftContract).transferFrom(address(this), e.buyer, e.rwaTokenId); //
            }
        } else {
            // Buyer wins: Get refund (minus fee). Seller gets the goods (NFT) back.
            require(token.transfer(e.buyer, amountAfterFee), "Transfer to buyer failed");

            // Return NFT to Seller
            if (e.rwaNftContract != address(0)) {
                IERC721(e.rwaNftContract).transferFrom(address(this), e.seller, e.rwaTokenId); //
            }
        }
        
        emit DisputeResolved(_invoiceId, msg.sender, _sellerWins);
    }
    
    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage e = escrows[_invoiceId];
        IERC20 token = IERC20(e.token);
        
        // Calculate amounts
        uint256 fee = e.feeAmount;
        uint256 sellerAmount = e.amount - fee;
        
        // Transfer fee to treasury
        if (fee > 0 && treasury != address(0)) {
            require(token.transfer(treasury, fee), "Fee transfer failed");
            emit FeeCollected(_invoiceId, fee, treasury);
        }
        
        // Transfer remaining funds to Seller
        require(token.transfer(e.seller, sellerAmount), "Transfer to seller failed");
        
        // --- NEW: Release RWA NFT to Buyer ---
        if (e.rwaNftContract != address(0)) {
            IERC721(e.rwaNftContract).transferFrom(address(this), e.buyer, e.rwaTokenId); //
        }
        
        emit EscrowReleased(_invoiceId, e.amount);
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