// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract FractionToken is ERC1155, Ownable {
    using Strings for uint256;
    
    // Mapping from invoice ID to token ID
    mapping(bytes32 => uint256) public invoiceToTokenId;
    
    // Mapping from token ID to invoice details
    mapping(uint256 => TokenDetails) public tokenDetails;
    
    // Counter for token IDs
    uint256 private currentTokenId = 1;
    
    struct TokenDetails {
        bytes32 invoiceId;
        uint256 totalSupply;
        uint256 remainingSupply; // FIX: Added field to track circulating supply
        uint256 faceValue;
        uint256 maturityDate;
        address issuer;
        bool isRedeemed;
    }
    
    event Tokenized(bytes32 indexed invoiceId, uint256 tokenId, uint256 totalSupply, uint256 faceValue);
    event Redeemed(uint256 indexed tokenId, address indexed redeemer, uint256 amount);
    
    // FIX: Initialized the Ownable constructor with msg.sender
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
            remainingSupply: _totalSupply, // FIX: Initialize remaining supply
            faceValue: _faceValue,
            maturityDate: _maturityDate,
            issuer: _issuer,
            isRedeemed: false
        });
        
        _mint(_issuer, tokenId, _totalSupply, "");
        
        emit Tokenized(_invoiceId, tokenId, _totalSupply, _faceValue);
        return tokenId;
    }
    
    function redeem(uint256 _tokenId, uint256 _amount) external {
        TokenDetails storage details = tokenDetails[_tokenId];
        require(block.timestamp >= details.maturityDate, "Not yet mature");
        require(!details.isRedeemed, "Already redeemed");
        require(balanceOf(msg.sender, _tokenId) >= _amount, "Insufficient tokens");
        
        // Calculate redemption value
        uint256 redemptionValue = (_amount * details.faceValue) / details.totalSupply;
        
        // Burn the tokens
        _burn(msg.sender, _tokenId, _amount);
        
        // FIX: Decrement the remaining supply
        details.remainingSupply -= _amount;

        // In a real implementation, you would transfer the redemption value here
        // For simplicity, we're just emitting an event
        emit Redeemed(_tokenId, msg.sender, redemptionValue);
        
        // FIX: Check remainingSupply to see if all tokens are burned
        if (details.remainingSupply == 0) {
            details.isRedeemed = true;
        }
    }
    
    function uri(uint256 _tokenId) public view override returns (string memory) {
        require(_tokenId > 0 && _tokenId < currentTokenId, "Nonexistent token");
        // NOTE: The base URI is already set in the ERC1155 constructor.
        // super.uri() will return the base URI. You don't need to concatenate the token ID again
        // as the ERC1155 standard expects clients to replace {id} with the hex token ID.
        // Returning just the base URI is usually sufficient.
        return super.uri(_tokenId);
    }
    
    function setURI(string memory _newuri) external onlyOwner {
        _setURI(_newuri);
    }
}