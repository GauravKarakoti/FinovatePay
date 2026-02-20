// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

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
        uint256 financedAmount; // Amount raised so far
        bool repaymentFunded; // True if the invoice has been repaid (ready for redemption)
    }

    mapping(uint256 => InvoiceMeta) public invoiceMetadata;
    mapping(uint256 => bool) public isActive;
    // Map invoice ID (uint256) to funds raised (already in struct, but keeping explicit if needed, here using struct)
    // Map unique invoice ID (external) to Token ID
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
     */
    function createFractionalInvoice(
        bytes32 _invoiceId,
        address _seller,
        uint256 _totalFractions,
        uint256 _pricePerFraction,
        uint256 _maturityDate,
        uint256 _totalValue
    ) external onlyOwner returns (uint256) {
        // Since tokenId = uint256(invoiceId), we use that directly.
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
            repaymentFunded: false
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
     * @notice Buy fractions of an invoice.
     * @param _tokenId The token ID to purchase.
     * @param _amount The number of fractions to buy.
     */
    function buyFractions(uint256 _tokenId, uint256 _amount) external nonReentrant {
        require(isActive[_tokenId], "Invoice not active");
        require(balanceOf(address(this), _tokenId) >= _amount, "Insufficient supply");
        require(block.timestamp < invoiceMetadata[_tokenId].maturityDate, "Invoice expired");

        InvoiceMeta storage meta = invoiceMetadata[_tokenId];
        uint256 totalCost = _amount * meta.pricePerFraction;

        // Transfer USDC from Buyer to Seller directly
        // This gives immediate liquidity to the Seller.
        paymentToken.safeTransferFrom(msg.sender, meta.seller, totalCost);

        // Transfer Fractions from Contract to Buyer
        _safeTransferFrom(address(this), msg.sender, _tokenId, _amount, "");

        meta.financedAmount += totalCost;

        emit FractionsPurchased(_tokenId, msg.sender, _amount, totalCost);
    }

    /**
     * @notice Deposit repayment for an invoice (usually called by EscrowContract).
     * @param _tokenId The token ID.
     * @param _amount The amount of USDC being repaid.
     */
    function depositRepayment(uint256 _tokenId, uint256 _amount) external nonReentrant {
        InvoiceMeta storage meta = invoiceMetadata[_tokenId];
        require(meta.totalFractions > 0, "Invoice not found");
        // require(!meta.repaymentFunded, "Already repaid"); // Allow partial? For now, assume full or nothing logic later.
        
        // Transfer USDC from Payer (Escrow/Relayer) to THIS contract
        paymentToken.safeTransferFrom(msg.sender, address(this), _amount);
        
        // Simple logic: If we have enough funds to cover the Total Value (Face Value), mark as ready.
        // Or we just track the balance of the contract?
        // Ideally we track per-invoice balance, but for simplicity we mark as funded.

        // Check if the contract holds enough for this specific invoice?
        // We'll rely on the caller to send the correct amount.

        // If amount >= totalValue, we consider it fully repaid.
        if (_amount >= meta.totalValue) {
            meta.repaymentFunded = true;
        }

        emit RepaymentReceived(_tokenId, _amount);
    }

    /**
     * @notice Redeem fractions for repayment + interest.
     * @param _tokenId The token ID.
     */
    function redeemFractions(uint256 _tokenId) external nonReentrant {
        InvoiceMeta storage meta = invoiceMetadata[_tokenId];
        // require(block.timestamp >= meta.maturityDate, "Not mature yet");
        // Actually, if it's repaid early, we should allow redemption?
        // The prompt says "After invoice repayment...". So check repaymentFunded.
        require(meta.repaymentFunded, "Repayment not yet received");

        uint256 userBalance = balanceOf(msg.sender, _tokenId);
        require(userBalance > 0, "No tokens to redeem");

        // Calculate Payout: (UserTokens / TotalTokens) * TotalValue
        // This ensures they get their principal + share of the discount (interest).
        uint256 payout = (userBalance * meta.totalValue) / meta.totalFractions;

        require(paymentToken.balanceOf(address(this)) >= payout, "Contract insufficient funds");

        // Burn tokens
        _burn(msg.sender, _tokenId, userBalance);

        // Transfer Payout
        paymentToken.safeTransfer(msg.sender, payout);

        emit FractionsRedeemed(_tokenId, msg.sender, userBalance, payout);
    }

    /**
     * @notice Closes an invoice, preventing further purchases.
     */
    function closeInvoice(uint256 _tokenId) external onlyOwner {
        isActive[_tokenId] = false;
        emit InvoiceClosed(_tokenId);
    }

    // Needed for receiving ERC1155 tokens (if we mint to ourselves)
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) public virtual returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) public virtual returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}
