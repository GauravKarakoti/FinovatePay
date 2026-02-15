// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./ComplianceManager.sol";

contract EscrowContract is ReentrancyGuard {
    using SafeERC20 for IERC20;

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
    
    function deposit(bytes32 _invoiceId, uint256 _amount) external payable nonReentrant onlyCompliant(msg.sender) {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.buyer == msg.sender, "Not the buyer");
        require(_amount == escrow.amount, "Incorrect amount");
        
        if (escrow.token == address(0)) {
            require(msg.value == _amount, "Incorrect ETH amount");
        } else {
            require(msg.value == 0, "ETH not expected");
            IERC20(escrow.token).safeTransferFrom(msg.sender, address(this), _amount);
        }

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
        require(escrow.disputeRaised, "No dispute raised");
        require(escrow.amount > 0, "Already resolved");
        
        escrow.disputeResolver = msg.sender;
        uint256 amount = escrow.amount;
        escrow.amount = 0;

        if (_sellerWins) {
            // Seller wins: Get paid. Buyer gets the goods (NFT).
            _payout(escrow.seller, amount, escrow.token);
            
            // Release NFT to Buyer (Ownership Transfer)
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId); //
            }
        } else {
            // Buyer wins: Get refund. Seller gets the goods (NFT) back.
            _payout(escrow.buyer, amount, escrow.token);

            // Return NFT to Seller
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId); //
            }
        }
        
        emit DisputeResolved(_invoiceId, msg.sender, _sellerWins);
    }
    
    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.amount > 0, "Already released");

        uint256 amount = escrow.amount;
        escrow.amount = 0;
        
        // Transfer funds to Seller
        _payout(escrow.seller, amount, escrow.token);
        
        // --- NEW: Release RWA NFT to Buyer ---
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId); //
        }
        
        emit EscrowReleased(_invoiceId, amount);
    }

    function _payout(address to, uint256 amount, address token) internal {
        if (token == address(0)) {
            (bool success, ) = payable(to).call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
    
    function expireEscrow(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(block.timestamp >= escrow.expiresAt, "Escrow not expired");
        require(!escrow.sellerConfirmed || !escrow.buyerConfirmed, "Already confirmed");
        require(escrow.amount > 0, "Already expired/released");

        uint256 amount = escrow.amount;
        escrow.amount = 0;
        
        // Return NFT to Seller (Default action on expiry)
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId); //
        }

        // Refund Buyer ONLY if they actually deposited
        if (escrow.buyerConfirmed) {
            _payout(escrow.buyer, amount, escrow.token);
        }
    }
}
