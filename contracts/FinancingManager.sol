// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title IFractionToken
 * @notice Interface for the FractionToken contract to access TokenDetails.
 * This is necessary to find the 'issuer' (seller) of the tokens.
 */
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

    /**
     * @notice Returns the details for a given token ID.
     */
    function tokenDetails(uint256 tokenId) external view returns (TokenDetails memory);
}

/**
 * @title FinancingManager
 * @author FinovatePay Team
 * @notice Manages the automated purchase of fractionalized invoice tokens.
 * This contract acts as an atomic swap marketplace, taking a platform fee
 * (the "spread") on each trade.
 *
 * @dev The investor (buyer) must approve this contract to spend their stablecoin.
 * The seller (token issuer) must grant 'setApprovalForAll' to this contract
 * on the FractionToken contract.
 */
contract FinancingManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IFractionToken public fractionToken;
    IERC20 public stablecoin;
    address public feeWallet;
    uint256 public stablecoinDecimals;

    /**
     * @notice Stores the platform's fee (spread) for each invoice token,
     * in basis points (BPS).
     * e.g., 50 BPS = 0.5%
     */
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

    /**
     * @notice Sets up the manager with key contract addresses.
     * @param _fractionToken The address of the FractionToken (ERC1155) contract.
     * @param _stablecoin The address of the payment stablecoin (ERC20) contract (e.g., USDC).
     * @param _feeWallet The address where platform fees will be collected.
     */
    constructor(address _fractionToken, address _stablecoin, address _feeWallet, uint256 _stablecoinDecimals) Ownable(msg.sender) {
        require(_fractionToken != address(0) && _stablecoin != address(0) && _feeWallet != address(0), "Invalid addresses");
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
     * for a specific invoice token, based on its risk profile.
     * @param _tokenId The token ID of the fractionalized invoice.
     * @param _spreadBps The fee in basis points (e.g., 100 BPS = 1%).
     */
    function setInvoiceSpread(uint256 _tokenId, uint256 _spreadBps) external onlyOwner {
        require(_spreadBps < 10000, "Spread must be less than 10000 BPS (100%)");
        invoiceSpreadBps[_tokenId] = _spreadBps;
        emit SpreadUpdated(_tokenId, _spreadBps);
    }

    /**
     * @notice Allows an investor to buy fractional tokens using Stablecoins (ERC20).
     * Assumes a 1:1 price between the stablecoin and the token's base units.
     * @param _tokenId The ID of the token to purchase.
     * @param _tokenAmount The amount of tokens to purchase (in base units, e.g., 10**18).
     */
    function buyFractions(uint256 _tokenId, uint256 _tokenAmount) external nonReentrant {
        require(_tokenAmount > 0, "Amount must be positive");
        
        IFractionToken.TokenDetails memory details = fractionToken.tokenDetails(_tokenId);
        address seller = details.issuer;
        uint256 spreadBps = invoiceSpreadBps[_tokenId];

        require(seller != address(0), "Invalid token ID or issuer");
        // require(spreadBps < 10000, "Spread not set or invalid"); // Optional check

        // --- FIX: CALCULATE SCALED PAYMENT AMOUNT ---
        // Converts 18-decimal token amount to Stablecoin precision
        // Formula: Amount * (10^StableDecimals) / (10^TokenDecimals)
        // Assuming FractionToken is always 18 decimals:
        uint256 paymentAmount = (_tokenAmount * (10 ** stablecoinDecimals)) / 1e18;
        
        require(paymentAmount > 0, "Payment amount too small");

        // Calculate fees based on the PAYMENT amount (Stablecoins), not the token amount
        uint256 platformFee = (paymentAmount * spreadBps) / 10000;
        uint256 sellerAmount = paymentAmount - platformFee;

        // Step 3a: Pull stablecoin (Use calculated paymentAmount)
        stablecoin.safeTransferFrom(msg.sender, address(this), paymentAmount);

        // Step 3b: Pull FractionToken (Use original _tokenAmount)
        fractionToken.safeTransferFrom(seller, msg.sender, _tokenId, _tokenAmount, "");

        // Step 3c & 3d: Distribute Stablecoins
        stablecoin.safeTransfer(seller, sellerAmount);
        stablecoin.safeTransfer(feeWallet, platformFee);

        emit FractionsPurchased(_tokenId, msg.sender, seller, _tokenAmount, platformFee);
    }

    /**
     * @notice Allows an investor to buy fractional tokens using the Native Currency (e.g. ETH, MATIC).
     * @dev Requires the buyer to send the exact amount of native currency matching _tokenAmount.
     * @param _tokenId The ID of the token to purchase.
     * @param _tokenAmount The amount of tokens to purchase.
     */
    function buyFractionsNative(uint256 _tokenId, uint256 _tokenAmount) external payable nonReentrant {
        require(_tokenAmount > 0, "Amount must be positive");
        require(msg.value == _tokenAmount, "Native currency amount must match token amount");

        // 1. Get Details
        IFractionToken.TokenDetails memory details = fractionToken.tokenDetails(_tokenId);
        address seller = details.issuer;
        uint256 spreadBps = invoiceSpreadBps[_tokenId];

        require(seller != address(0), "Invalid token ID or issuer");
        require(spreadBps < 10000, "Spread not set or invalid");

        // 2. Calculate Amounts
        uint256 platformFee = (_tokenAmount * spreadBps) / 10000;
        uint256 sellerAmount = _tokenAmount - platformFee;
        
        require(sellerAmount > 0, "Spread is too high or amount is too low");

        // 3. Perform Atomic Swap
        
        // Step 3a: Pull FractionToken from seller to investor (msg.sender).
        fractionToken.safeTransferFrom(seller, msg.sender, _tokenId, _tokenAmount, "");

        // Step 3b: Transfer Native Currency to the seller.
        (bool successSeller, ) = payable(seller).call{value: sellerAmount}("");
        require(successSeller, "Transfer to seller failed");

        // Step 3c: Transfer platform fee to the fee wallet.
        (bool successFee, ) = payable(feeWallet).call{value: platformFee}("");
        require(successFee, "Transfer to fee wallet failed");

        // 4. Emit Event
        emit FractionsPurchased(_tokenId, msg.sender, seller, _tokenAmount, platformFee);
    }
}