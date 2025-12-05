// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
// --- ADD ReentrancyGuard ---
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// --- INHERIT from ReentrancyGuard ---
contract FractionToken is ERC1155, Ownable, ReentrancyGuard {
    using Strings for uint256;

    // Standard 18 decimals for all fractional tokens (same as MATIC/ETH)
    uint8 public constant DECIMALS = 18;

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
        uint256 totalFunded; // TWEAK: Track funded amount for partial funding transparency
    }

    event Tokenized(bytes32 indexed invoiceId, uint256 tokenId, uint256 totalSupply, uint256 faceValue);
    event Redeemed(uint256 indexed tokenId, address indexed redeemer, uint256 redemptionValue);
    event TokensPurchased(uint256 indexed tokenId, address indexed buyer, uint256 amount, uint256 payment);
    event RedemptionFunded(uint256 indexed tokenId, address indexed funder, uint256 amount);
    
    constructor() 
        ERC1155("https://api.finovatepay.com/token/{id}.json") 
        Ownable(msg.sender) 
        ReentrancyGuard() // Initialize ReentrancyGuard
    {}

    /**
     * @notice Tokenizes an invoice.
     * @dev _totalSupply and _faceValue MUST be passed in their base units (e.g., multiplied by 10**18).
     * @dev To tokenize 0.01 tokens, pass _totalSupply = 10000000000000000.
     */
    function tokenizeInvoice(
        bytes32 _invoiceId,
        uint256 _totalSupply,
        uint256 _faceValue,
        uint256 _maturityDate,
        address _issuer
    ) external onlyOwner returns (uint256) {
        require(invoiceToTokenId[_invoiceId] == 0, "Invoice already tokenized");
        require(_totalSupply > 0, "Total supply must be greater than 0");

        uint256 tokenId = currentTokenId++;
        invoiceToTokenId[_invoiceId] = tokenId;
        
        tokenDetails[tokenId] = TokenDetails({
            invoiceId: _invoiceId,
            totalSupply: _totalSupply,
            remainingSupply: _totalSupply,
            faceValue: _faceValue,
            maturityDate: _maturityDate,
            issuer: _issuer,
            isRedeemed: false,
            totalFunded: 0
        });
        
        _mint(owner(), tokenId, _totalSupply, "");
        emit Tokenized(_invoiceId, tokenId, _totalSupply, _faceValue);
        return tokenId;
    }

    /**
     * @notice Allows issuer to fund the contract to pay for redemptions.
     * @dev This must be called before 'redeem' can be used.
     * @dev The contract must be funded with MATIC equal to the token's total faceValue.
     */
    function fundRedemption(uint256 _tokenId) external payable {
        TokenDetails storage details = tokenDetails[_tokenId];
        require(msg.sender == details.issuer, "Only issuer can fund");
        require(!details.isRedeemed, "Already redeemed");
        require(msg.value > 0, "Must send MATIC");

        // TWEAK: Allow partials but track them
        details.totalFunded += msg.value;
        
        emit RedemptionFunded(_tokenId, msg.sender, msg.value);
    }

    function redeem(uint256 _tokenId, uint256 _amount) external nonReentrant {
        TokenDetails storage details = tokenDetails[_tokenId];
        require(block.timestamp >= details.maturityDate, "Not yet mature");
        
        uint256 redemptionValue = (_amount * details.faceValue) / details.totalSupply;
        require(redemptionValue > 0, "Redemption value is zero");
        
        require(details.totalFunded >= redemptionValue, "Insufficient funding for this specific token");
        require(address(this).balance >= redemptionValue, "Contract has insufficient funds");

        _burn(msg.sender, _tokenId, _amount);
        details.remainingSupply -= _amount;
        details.totalFunded -= redemptionValue; // Deduct from tracked funds

        if (details.remainingSupply == 0) {
            details.isRedeemed = true;
        }

        (bool success, ) = payable(msg.sender).call{value: redemptionValue}("");
        require(success, "Transfer failed");
        
        emit Redeemed(_tokenId, msg.sender, redemptionValue);
    }

    /**
     * @notice Allows an investor to purchase tokens by paying with MATIC.
     * @dev Assumes 1:1 price (1 base unit of token = 1 WEI of MATIC).
     * @dev To buy 0.01 tokens, send _amount = 10000000000000000 and msg.value = 10000000000000000.
     * @param _tokenId The ID of the token to purchase.
     * @param _amount The amount of tokens to purchase (in base units, 10**18).
     * @param _tokenHolder The address that currently holds the tokens for sale.
     */
    function purchaseTokens(
        uint256 _tokenId,
        uint256 _amount,
        address _tokenHolder
    ) external payable nonReentrant { // <-- Added nonReentrant
        TokenDetails storage details = tokenDetails[_tokenId];
        require(details.totalSupply > 0, "Token does not exist");
        require(_amount > 0, "Amount must be positive");

        // This is the core 1:1 WEI-for-WEI price logic
        uint256 paymentAmount = _amount;
        require(msg.value == paymentAmount, "Incorrect MATIC value sent");

        // --- Checks-Effects-Interactions Pattern ---
        // 1. Interaction (Payment to Seller)
        (bool success, ) = payable(_tokenHolder).call{value: msg.value}("");
        require(success, "MATIC payment to holder failed");
        
        // 2. Effect (Token Transfer)
        _safeTransferFrom(_tokenHolder, msg.sender, _tokenId, _amount, "");
        
        emit TokensPurchased(_tokenId, msg.sender, _amount, paymentAmount);
    }

    function uri(uint256 _tokenId) public view override returns (string memory) {
        require(_tokenId > 0 && _tokenId < currentTokenId, "Nonexistent token");
        return super.uri(_tokenId);
    }
    
    function setURI(string memory _newuri) external onlyOwner {
        _setURI(_newuri);
    }
}