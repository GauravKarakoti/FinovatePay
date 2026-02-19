// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract Treasury {
    address public timelock;

    event TimelockUpdated(address indexed newTimelock);
    event ETHWithdrawn(address indexed to, uint256 amount);
    event ERC20Withdrawn(address indexed token, address indexed to, uint256 amount);
    event ERC721Withdrawn(address indexed token, address indexed to, uint256 tokenId);

    modifier onlyTimelock() {
        require(msg.sender == timelock, "only Governance");
        _;
    }

    constructor(address _timelock) {
        require(_timelock != address(0), "Invalid timelock");
        timelock = _timelock;
    }

    receive() external payable {}

    function setTimelock(address _timelock) external onlyTimelock {
        require(_timelock != address(0), "Invalid timelock");
        timelock = _timelock;
        emit TimelockUpdated(_timelock);
    }

    function withdrawETH(address to, uint256 amount) external onlyTimelock {
        require(to != address(0), "Invalid recipient");
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "ETH transfer failed");
        emit ETHWithdrawn(to, amount);
    }

    function withdrawERC20(
        address token,
        address to,
        uint256 amount
    ) external onlyTimelock {
        require(to != address(0), "Invalid recipient");
        require(IERC20(token).transfer(to, amount), "ERC20 transfer failed");
        emit ERC20Withdrawn(token, to, amount);
    }

    function withdrawERC721(
        address token,
        address to,
        uint256 tokenId
    ) external onlyTimelock {
        require(to != address(0), "Invalid recipient");
        IERC721(token).transferFrom(address(this), to, tokenId);
        emit ERC721Withdrawn(token, to, tokenId);
    }
}
