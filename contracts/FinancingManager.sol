// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IFractionToken is IERC1155 {
    struct TokenDetails {
        bytes32 invoiceId;
        uint256 totalSupply;
        uint256 remainingSupply;
        uint256 faceValue;
        uint256 maturityDate;
        address issuer;
        bool isRedeemed;
    }
    function tokenDetails(uint256 tokenId) external view returns (TokenDetails memory);
}

/**
 * @title FinancingManager
 * @author FinovatePay Team
 * @notice Manages the automated purchase of fractionalized invoice tokens.
 * This contract acts as an atomic swap marketplace, taking a platform fee
 * (the "spread") on each trade.
 */
contract FinancingManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IFractionToken public fractionToken;
    IERC20 public stablecoin;
    address public feeWallet;
    uint256 public stablecoinDecimals;

    // NEW: Price of 1 full token unit (1e18) in Native Currency (Wei)
    // Example: If 1 Token = 0.01 ETH, set this to 10000000000000000
    uint256 public nativePerToken; 

    mapping(uint256 => uint256) public invoiceSpreadBps;

    event FractionsPurchased(
        uint256 indexed tokenId,
        address indexed buyer,
        address indexed seller,
        uint256 tokenAmount,
        uint256 platformFee
    );
    event SpreadUpdated(uint256 indexed tokenId, uint256 newSpreadBps);
    event ContractsUpdated(address newFractionToken, address newStablecoin, address newFeeWallet);
    event NativePriceUpdated(uint256 newPrice); // NEW Event

    constructor(
        address _fractionToken, 
        address _stablecoin, 
        address _feeWallet, 
        uint256 _stablecoinDecimals
    ) Ownable(msg.sender) {
        require(_fractionToken != address(0) && _stablecoin != address(0) && _feeWallet != address(0), "Invalid addresses");
        require(_stablecoinDecimals > 0 && _stablecoinDecimals <= 18, "Invalid stablecoin decimals");
        
        fractionToken = IFractionToken(_fractionToken);
        stablecoin = IERC20(_stablecoin);
        feeWallet = _feeWallet;
        stablecoinDecimals = _stablecoinDecimals;

        emit ContractsUpdated(_fractionToken, _stablecoin, _feeWallet);
    }

    /**
     * @notice Allows the owner to update the contract addresses.
     */
    function setContracts(address _fractionToken, address _stablecoin, address _feeWallet) external onlyOwner {
        require(_fractionToken != address(0) && _stablecoin != address(0) && _feeWallet != address(0), "Invalid addresses");
        fractionToken = IFractionToken(_fractionToken);
        stablecoin = IERC20(_stablecoin);
        feeWallet = _feeWallet;
        emit ContractsUpdated(_fractionToken, _stablecoin, _feeWallet);
    }

    /**
     * @notice Allows the owner (platform) to set the financing spread (fee)
     * for a specific invoice token.
     */
    function setInvoiceSpread(uint256 _tokenId, uint256 _spreadBps) external onlyOwner {
        require(_spreadBps < 10000, "Spread must be less than 10000 BPS (100%)");
        invoiceSpreadBps[_tokenId] = _spreadBps;
        emit SpreadUpdated(_tokenId, _spreadBps);
    }

    /**
     * @notice NEW: Sets the price of 1 Token in Native Currency (Wei).
     * @param _price The price in Wei for 1e18 units of the token.
     */
    function setNativePerToken(uint256 _price) external onlyOwner {
        require(_price > 0, "Price must be greater than zero");
        nativePerToken = _price;
        emit NativePriceUpdated(_price);
    }

    /**
     * @notice Purchases fractions using ERC20 Stablecoin.
     */
    function buyFractions(uint256 _tokenId, uint256 _tokenAmount) external nonReentrant {
        require(_tokenAmount > 0, "Amount must be positive");
        
        IFractionToken.TokenDetails memory details = fractionToken.tokenDetails(_tokenId);
        address seller = details.issuer;
        uint256 spreadBps = invoiceSpreadBps[_tokenId];

        require(seller != address(0), "Invalid token ID or issuer");
        require(spreadBps < 10000, "Spread not set or invalid");

        // Formula: Amount * (10^StableDecimals) / (10^TokenDecimals)
        uint256 paymentAmount = (_tokenAmount * (10 ** stablecoinDecimals)) / 1e18;
        require(paymentAmount > 0, "Payment amount too small");

        uint256 platformFee = (paymentAmount * spreadBps) / 10000;
        uint256 sellerAmount = paymentAmount - platformFee;

        stablecoin.safeTransferFrom(msg.sender, address(this), paymentAmount);
        fractionToken.safeTransferFrom(seller, msg.sender, _tokenId, _tokenAmount, "");
        stablecoin.safeTransfer(seller, sellerAmount);
        stablecoin.safeTransfer(feeWallet, platformFee);

        emit FractionsPurchased(_tokenId, msg.sender, seller, _tokenAmount, platformFee);
    }

    /**
     * @notice Allows an investor to buy fractional tokens using Native Currency (ETH/MATIC).
     * @dev Calculates cost based on nativePerToken. Refunds excess ETH.
     * @param _tokenId The ID of the token to purchase.
     * @param _tokenAmount The amount of tokens to purchase (in 1e18 units).
     */
    function buyFractionsNative(uint256 _tokenId, uint256 _tokenAmount) external payable nonReentrant {
        require(_tokenAmount > 0, "Amount must be positive");
        require(nativePerToken > 0, "Native price not set");

        // 1. Calculate required Native Currency
        // Formula: (Token Amount * Price Per Token) / 1e18
        uint256 requiredNative = (_tokenAmount * nativePerToken) / 1e18;
        
        require(msg.value >= requiredNative, "Insufficient native currency sent");

        // 2. Get Details
        IFractionToken.TokenDetails memory details = fractionToken.tokenDetails(_tokenId);
        address seller = details.issuer;
        uint256 spreadBps = invoiceSpreadBps[_tokenId];

        require(seller != address(0), "Invalid token ID or issuer");
        require(spreadBps < 10000, "Spread not set or invalid");

        // 3. Calculate Fee and Seller Amount based on NATIVE value
        uint256 platformFee = (requiredNative * spreadBps) / 10000;
        uint256 sellerAmount = requiredNative - platformFee;
        
        // 4. Perform Transfers
        
        // Step 4a: Pull FractionToken from seller to investor
        fractionToken.safeTransferFrom(seller, msg.sender, _tokenId, _tokenAmount, "");

        // Step 4b: Transfer Native Currency to the seller
        (bool successSeller, ) = payable(seller).call{value: sellerAmount}("");
        require(successSeller, "Transfer to seller failed");

        // Step 4c: Transfer platform fee to the fee wallet
        (bool successFee, ) = payable(feeWallet).call{value: platformFee}("");
        require(successFee, "Transfer to fee wallet failed");

        // Step 4d: Refund excess Native Currency to buyer (if any)
        if (msg.value > requiredNative) {
            (bool successRefund, ) = payable(msg.sender).call{value: msg.value - requiredNative}("");
            require(successRefund, "Refund failed");
        }

        // 5. Emit Event
        emit FractionsPurchased(_tokenId, msg.sender, seller, _tokenAmount, platformFee);
    }
}