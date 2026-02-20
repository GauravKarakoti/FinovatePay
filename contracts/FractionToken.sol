// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title FractionToken
 * @author FinovatePay Team
 * @notice Mints and manages fractionalized invoice tokens (ERC1155) representing future revenue claims.
 */
contract FractionToken is ERC1155, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    IERC20 public paymentToken; // USDC

    struct InvoiceMeta {
        address seller;
        uint256 totalFractions;
        uint256 pricePerFraction;
        uint256 maturityDate;
        uint256 totalValue; // Face value (Repayment amount)
        uint256 financedAmount;
        bool repaymentFunded; // True if the invoice has been repaid
        uint256 yieldBps; // Yield/interest rate in basis points
    }

    // Required for compatibility with FinancingManager IFractionToken interface
    struct TokenDetails {
        bytes32 invoiceId;
        uint256 totalSupply;
        uint256 remainingSupply;
        uint256 faceValue;
        uint256 maturityDate;
        address issuer;
        bool isRedeemed;
        uint256 yieldBps;
    }

    mapping(uint256 => InvoiceMeta) public invoiceMetadata;
    mapping(uint256 => bool) public isActive;
    mapping(bytes32 => uint256) public invoiceToTokenId;

    event InvoiceFractionalized(
        bytes32 indexed invoiceId,
        uint256 tokenId,
        address seller,
        uint256 totalFractions,
        uint256 pricePerFraction
    );
    event FractionsPurchased(
        uint256 indexed tokenId,
        address indexed buyer,
        uint256 amount,
        uint256 totalCost
    );
    event RepaymentReceived(
        uint256 indexed tokenId,
        uint256 amount
    );
    event FractionsRedeemed(
        uint256 indexed tokenId,
        address indexed redeemer,
        uint256 amount,
        uint256 payout
    );
    event InvoiceClosed(uint256 indexed tokenId);

    constructor(address _paymentToken)
        ERC1155("https://api.finovatepay.com/token/{id}.json") 
        Ownable(msg.sender)
    {
        require(_paymentToken != address(0), "Invalid payment token");
        paymentToken = IERC20(_paymentToken);
    }

    /**
     * @notice Creates a fractionalized invoice (mints ERC-1155 tokens).
     * @param _invoiceId The unique identifier of the invoice (bytes32).
     * @param _seller The address of the seller receiving the financing.
     * @param _totalFractions Total number of fractional units to mint.
     * @param _pricePerFraction Price per unit in paymentToken (USDC) base units.
     * @param _maturityDate Timestamp after which tokens can be redeemed (if repaid).
     * @param _totalValue The total face value of the invoice (expected repayment).
     * @param _yieldBps The yield percentage for investors (basis points).
     */
    function tokenizeInvoice(
        bytes32 _invoiceId,
        address _seller,
        uint256 _totalFractions,
        uint256 _pricePerFraction,
        uint256 _maturityDate,
        uint256 _totalValue,
        uint256 _yieldBps
    ) external onlyOwner returns (uint256) {
        uint256 tokenId = uint256(_invoiceId);
        require(tokenId != 0, "Invalid Token ID");
        require(invoiceMetadata[tokenId].totalFractions == 0, "Invoice already exists");
        require(_totalFractions > 0, "Invalid total fractions");
        require(_seller != address(0), "Invalid seller");

        invoiceMetadata[tokenId] = InvoiceMeta({
            seller: _seller,
            totalFractions: _totalFractions,
            pricePerFraction: _pricePerFraction,
            maturityDate: _maturityDate,
            totalValue: _totalValue,
            financedAmount: 0,
            repaymentFunded: false,
            yieldBps: _yieldBps
        });

        isActive[tokenId] = true;
        invoiceToTokenId[_invoiceId] = tokenId;

        // Mint tokens to THIS contract.
        // The contract acts as the marketplace custodian.
        _mint(address(this), tokenId, _totalFractions, "");

        emit InvoiceFractionalized(_invoiceId, tokenId, _seller, _totalFractions, _pricePerFraction);
        return tokenId;
    }

    /**
     * @notice Returns metadata for FinancingManager interface compatibility.
     */
    function tokenDetails(uint256 tokenId) external view returns (TokenDetails memory) {
        InvoiceMeta memory meta = invoiceMetadata[tokenId];
        return TokenDetails({
            invoiceId: bytes32(tokenId),
            totalSupply: meta.totalFractions,
            remainingSupply: balanceOf(address(this), tokenId),
            faceValue: meta.totalValue,
            maturityDate: meta.maturityDate,
            issuer: meta.seller,
            isRedeemed: meta.repaymentFunded,
            yieldBps: meta.yieldBps
        });
    }

    /**
     * @notice Buy fractions of an invoice directly (Primary Market).
     * @param _tokenId The token ID to purchase.
     * @param _amount The number of fractions to buy.
     */
    function buyFractions(uint256 _tokenId, uint256 _amount) external nonReentrant {
        require(isActive[_tokenId], "Invoice not active");
        require(balanceOf(address(this), _tokenId) >= _amount, "Insufficient supply");
        require(block.timestamp < invoiceMetadata[_tokenId].maturityDate, "Invoice expired");

        InvoiceMeta storage meta = invoiceMetadata[_tokenId];
        uint256 totalCost = _amount * meta.pricePerFraction;

        // Transfer USDC from Buyer to Seller directly to provide immediate liquidity.
        paymentToken.safeTransferFrom(msg.sender, meta.seller, totalCost);

        // Transfer Fractions from Contract custodian to Buyer.
        _safeTransferFrom(address(this), msg.sender, _tokenId, _amount, "");
        meta.financedAmount += totalCost;

        emit FractionsPurchased(_tokenId, msg.sender, _amount, totalCost);
    }

    /**
     * @notice Deposit repayment for an invoice (called by EscrowContract).
     * @param _tokenId The token ID.
     * @param _amount The amount of USDC being repaid.
     */
    function depositRepayment(uint256 _tokenId, uint256 _amount) external nonReentrant {
        InvoiceMeta storage meta = invoiceMetadata[_tokenId];
        require(meta.totalFractions > 0, "Invoice not found");
        
        // Transfer USDC from Payer (Escrow/Relayer) to THIS contract to pool for redemption.
        paymentToken.safeTransferFrom(msg.sender, address(this), _amount);

        // If the contract holds enough for the face value, mark it as ready for redemption.
        if (_amount >= meta.totalValue) {
            meta.repaymentFunded = true;
        }

        emit RepaymentReceived(_tokenId, _amount);
    }

    /**
     * @notice Redeem fractions for repayment + interest (share of total value).
     * @param _tokenId The token ID.
     */
    function redeemFractions(uint256 _tokenId) external nonReentrant {
        InvoiceMeta storage meta = invoiceMetadata[_tokenId];
        require(meta.repaymentFunded, "Repayment not yet received");

        uint256 userBalance = balanceOf(msg.sender, _tokenId);
        require(userBalance > 0, "No tokens to redeem");

        // Payout Calculation: (UserTokens / TotalTokens) * TotalValue.
        uint256 payout = (userBalance * meta.totalValue) / meta.totalFractions;

        require(paymentToken.balanceOf(address(this)) >= payout, "Contract insufficient funds");
        
        _burn(msg.sender, _tokenId, userBalance); // Burn tokens upon claim.
        paymentToken.safeTransfer(msg.sender, payout); // Distribute share of profit/principal.

        emit FractionsRedeemed(_tokenId, msg.sender, userBalance, payout);
    }

    /**
     * @notice Closes an invoice, preventing further purchases.
     */
    function closeInvoice(uint256 _tokenId) external onlyOwner {
        isActive[_tokenId] = false;
        emit InvoiceClosed(_tokenId);
    }

    // Boilerplate for receiving ERC1155 tokens
    function onERC1155Received(address, address, uint256, uint256, bytes memory) public virtual returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] memory, uint256[] memory, bytes memory) public virtual returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}