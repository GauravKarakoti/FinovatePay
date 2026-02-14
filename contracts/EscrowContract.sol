// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./ComplianceManager.sol";

contract EscrowContract is ReentrancyGuard, EIP712 {
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
        // --- NEW: Discount Logic ---
        uint256 discountRate;     // In basis points (e.g., 200 = 2%)
        uint256 discountDeadline; // Unix timestamp
    }
    
    mapping(bytes32 => Escrow) public escrows;
    ComplianceManager public complianceManager;
    address public admin;

    // Meta-transaction support
    mapping(address => uint256) public nonces;
    bytes32 private constant _TYPEHASH = keccak256("MetaTransaction(uint256 nonce,address from,bytes functionSignature)");
    
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);

    modifier onlyAdmin() {
        require(_msgSender() == admin, "Not admin");
        _;
    }
    
    modifier onlyCompliant(address _account) {
        require(!complianceManager.isFrozen(_account), "Account frozen");
        require(complianceManager.isKYCVerified(_account), "KYC not verified");
        require(complianceManager.hasIdentity(_account), "Identity not verified (No SBT)");
        _;
    }
    
    constructor(address _complianceManager) EIP712("EscrowContract", "1") {
        admin = msg.sender;
        complianceManager = ComplianceManager(_complianceManager);
    }

    // --- Meta-Transaction Support ---
    function executeMetaTx(
        address user,
        bytes calldata functionData,
        bytes calldata signature
    ) external returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(_TYPEHASH, nonces[user], user, keccak256(functionData))
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, signature);

        require(signer == user, "Invalid signature");
        nonces[user]++;

        // Append user address to the end of call data
        (bool success, bytes memory returnData) = address(this).call(abi.encodePacked(functionData, user));
        require(success, "Function call failed");

        return returnData;
    }

    function _msgSender() internal view virtual returns (address) {
        if (msg.sender == address(this)) {
            // Read the last 20 bytes of the calldata to get the original sender
            return address(bytes20(msg.data[msg.data.length - 20:]));
        }
        return msg.sender;
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
        uint256 _rwaTokenId,
        // --- NEW: Discount Parameters ---
        uint256 _discountRate,
        uint256 _discountDeadline
    ) external onlyCompliant(_msgSender()) returns (bool) {
        require(escrows[_invoiceId].seller == address(0), "Escrow already exists");
        require(_amount > 0, "Amount must be > 0");
        require(_discountRate <= 10000, "Invalid discount rate");

        // Ensure the caller is the seller or the admin
        require(_seller == _msgSender() || _msgSender() == admin, "Only seller or admin");

        if (_discountRate > 0) {
            require(_discountDeadline > block.timestamp, "Deadline must be future");
        }

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
            discountRate: _discountRate,
            discountDeadline: _discountDeadline
        });

        emit EscrowCreated(_invoiceId, _seller, _buyer, _amount);
        return true;
    }
    
    function deposit(bytes32 _invoiceId) external payable nonReentrant onlyCompliant(_msgSender()) {
        address sender = _msgSender();
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.buyer == sender, "Not the buyer");
        require(!escrow.buyerConfirmed, "Already paid");
        
        uint256 payableAmount = _getPayableAmount(escrow);

        if (escrow.token == address(0)) {
             require(msg.value == payableAmount, "Incorrect native amount");
        } else {
             IERC20 token = IERC20(escrow.token);
             require(token.transferFrom(sender, address(this), payableAmount), "Transfer failed");
        }

        // Update amount to what was actually paid so release/refund works correctly with the balance held
        escrow.amount = payableAmount;
        escrow.buyerConfirmed = true;

        emit DepositConfirmed(_invoiceId, sender, payableAmount);
    }

    function _getPayableAmount(Escrow storage escrow) internal view returns (uint256) {
        if (escrow.discountRate > 0 && block.timestamp <= escrow.discountDeadline) {
             uint256 discount = (escrow.amount * escrow.discountRate) / 10000;
             return escrow.amount - discount;
        }
        return escrow.amount;
    }

    function getCurrentPayableAmount(bytes32 _invoiceId) external view returns (uint256) {
        Escrow storage escrow = escrows[_invoiceId];
        return _getPayableAmount(escrow);
    }
    
    function confirmRelease(bytes32 _invoiceId) external nonReentrant {
        address sender = _msgSender();
        Escrow storage escrow = escrows[_invoiceId];
        require(sender == escrow.seller || sender == escrow.buyer, "Not a party to this escrow");

        if (sender == escrow.seller) {
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
        address sender = _msgSender();
        Escrow storage escrow = escrows[_invoiceId];
        require(sender == escrow.seller || sender == escrow.buyer, "Not a party to this escrow");
        require(!escrow.disputeRaised, "Dispute already raised");
        
        escrow.disputeRaised = true;
        emit DisputeRaised(_invoiceId, sender);
    }
    
    function resolveDispute(bytes32 _invoiceId, bool _sellerWins) external onlyAdmin {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.disputeRaised, "No dispute raised");
        
        escrow.disputeResolver = _msgSender();
        IERC20 token = IERC20(escrow.token);

        if (_sellerWins) {
            // Seller wins: Get paid. Buyer gets the goods (NFT).
            require(token.transfer(escrow.seller, escrow.amount), "Transfer to seller failed");
            
            // Release NFT to Buyer (Ownership Transfer)
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId); //
            }
        } else {
            // Buyer wins: Get refund. Seller gets the goods (NFT) back.
            require(token.transfer(escrow.buyer, escrow.amount), "Transfer to buyer failed");

            // Return NFT to Seller
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId); //
            }
        }
        
        emit DisputeResolved(_invoiceId, _msgSender(), _sellerWins);
    }
    
    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        IERC20 token = IERC20(escrow.token);
        
        // Transfer funds to Seller
        require(token.transfer(escrow.seller, escrow.amount), "Transfer failed");
        
        // --- NEW: Release RWA NFT to Buyer ---
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId); //
        }
        
        emit EscrowReleased(_invoiceId, escrow.amount);
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