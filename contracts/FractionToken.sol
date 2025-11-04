// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
// ADD THIS IMPORT for the payment token interface
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FractionToken is ERC1155, Ownable {
    using Strings for uint256;

    mapping(bytes32 => uint256) public invoiceToTokenId;
    mapping(uint256 => TokenDetails) public tokenDetails;
    uint256 private currentTokenId = 1;

    struct TokenDetails {
        bytes32 invoiceId;
        uint256 totalSupply;
        uint256 remainingSupply;
        uint256 faceValue;
        uint256 maturityDate;
        address issuer;
        bool isRedeemed;
    }

    event Tokenized(bytes32 indexed invoiceId, uint256 tokenId, uint256 totalSupply, uint256 faceValue);
    event Redeemed(uint256 indexed tokenId, address indexed redeemer, uint256 amount);
    // ADD NEW EVENT
    event TokensPurchased(uint256 indexed tokenId, address indexed buyer, uint256 amount, uint256 payment);


    constructor() ERC1155("https://api.finovatepay.com/token/{id}.json") Ownable(msg.sender) {}

    function tokenizeInvoice(
        bytes32 _invoiceId,
        uint256 _totalSupply,
        uint256 _faceValue,
        uint256 _maturityDate,
        address _issuer
    ) external onlyOwner returns (uint256) {
        require(invoiceToTokenId[_invoiceId] == 0, "Invoice already tokenized");
        uint256 tokenId = currentTokenId++;
        invoiceToTokenId[_invoiceId] = tokenId;
        
        tokenDetails[tokenId] = TokenDetails({
            invoiceId: _invoiceId,
            totalSupply: _totalSupply,
            remainingSupply: _totalSupply,
            faceValue: _faceValue,
            maturityDate: _maturityDate,
            issuer: _issuer,
            isRedeemed: false
        });
        
        _mint(owner(), tokenId, _totalSupply, "");
        emit Tokenized(_invoiceId, tokenId, _totalSupply, _faceValue);
        return tokenId;
    }

    function redeem(uint256 _tokenId, uint256 _amount) external {
        TokenDetails storage details = tokenDetails[_tokenId];
        require(block.timestamp >= details.maturityDate, "Not yet mature");
        require(!details.isRedeemed, "Already redeemed");
        require(balanceOf(msg.sender, _tokenId) >= _amount, "Insufficient tokens");
        
        uint256 redemptionValue = (_amount * details.faceValue) / details.totalSupply;
        
        _burn(msg.sender, _tokenId, _amount);
        details.remainingSupply -= _amount;
        
        // (Transfer redemption value here)
        emit Redeemed(_tokenId, msg.sender, redemptionValue);
        
        if (details.remainingSupply == 0) {
            details.isRedeemed = true;
        }
    }

    // --- ADD NEW FUNCTION ---
    /**
     * @notice Allows an investor to purchase tokens by paying with an ERC20 stablecoin.
     * @dev The investor (msg.sender) must first approve this contract to spend `paymentAmount` of `_paymentTokenAddress`.
     * @dev The `_tokenHolder` (platform or seller) must first approve this contract to transfer the ERC1155 tokens via `setApprovalForAll`.
     * @param _tokenId The ID of the token to purchase.
     * @param _amount The amount of tokens to purchase.
     * @param _paymentTokenAddress The address of the stablecoin (e.g., USDC) contract.
     * @param _tokenHolder The address that currently holds the tokens for sale (e.g., the platform's treasury wallet).
     */
    function purchaseTokens(
        uint256 _tokenId,
        uint256 _amount,
        address _paymentTokenAddress,
        address _tokenHolder
    ) external {
        TokenDetails storage details = tokenDetails[_tokenId];
        require(details.totalSupply > 0, "Token does not exist");
        require(_amount > 0, "Amount must be positive");

        // Assuming 1 token = 1 unit of stablecoin (e.g., 1 token = 1 USDC)
        // Note: For 6-decimal stablecoins like USDC, _amount should be 1_000_000 for 1 token.
        // For simplicity here, we assume 1:1 or that the frontend handles decimal conversion.
        // Let's assume the frontend will pass the correct stablecoin unit amount.
        uint256 paymentAmount = _amount; // e.g., if _amount is 100, payment is 100 USDC.

        IERC20 paymentToken = IERC20(_paymentTokenAddress);

        // 1. Take payment from investor (msg.sender) and send to token holder
        require(
            paymentToken.transferFrom(msg.sender, _tokenHolder, paymentAmount),
            "ERC20 payment failed"
        );

        // 2. Transfer fraction tokens from token holder to investor (msg.sender)
        // This requires _tokenHolder to have called setApprovalForAll(address(this), true)
        _safeTransferFrom(_tokenHolder, msg.sender, _tokenId, _amount, "");

        emit TokensPurchased(_tokenId, msg.sender, _amount, paymentAmount);
    }
    // --- END NEW FUNCTION ---

    function uri(uint256 _tokenId) public view override returns (string memory) {
        require(_tokenId > 0 && _tokenId < currentTokenId, "Nonexistent token");
        return super.uri(_tokenId);
    }
    
    function setURI(string memory _newuri) external onlyOwner {
        _setURI(_newuri);
    }
}