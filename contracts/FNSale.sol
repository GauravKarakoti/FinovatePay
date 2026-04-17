// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IFinovateToken {
    function mintFromRewards(address to, uint256 amount) external;
}

contract FNSale is Ownable {
    IFinovateToken public fnToken;
    
    // 0.01 ETH = 100,000 FN -> 1 ETH = 10,000,000 FN
    uint256 public constant RATE = 10_000_000; 

    event TokensPurchased(address indexed buyer, uint256 ethAmount, uint256 fnAmount);

    constructor(address _fnToken) Ownable(msg.sender) {
        fnToken = IFinovateToken(_fnToken);
    }

    function buyTokens() external payable {
        require(msg.value > 0, "Amount must be greater than 0");
        
        uint256 fnAmount = msg.value * RATE;
        
        // Requires this contract to be set as the rewardsController in FinovateToken
        fnToken.mintFromRewards(msg.sender, fnAmount);
        
        emit TokensPurchased(msg.sender, msg.value, fnAmount);
    }

    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}