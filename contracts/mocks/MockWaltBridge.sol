// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockWaltBridge {
    event TokensLocked(address indexed token, uint256 amount, bytes32 destinationChain, address recipient);
    event TokensMinted(address indexed token, uint256 amount, bytes32 sourceChain, address recipient);
    event TokensLocked1155(address indexed token, uint256 tokenId, uint256 amount, bytes32 destinationChain, address recipient);
    event TokensMinted1155(address indexed token, uint256 tokenId, uint256 amount, bytes32 sourceChain, address recipient);

    function lockAndSend(address token, uint256 amount, bytes32 destinationChain, address recipient) external {
        emit TokensLocked(token, amount, destinationChain, recipient);
    }

    function mintAndSend(address token, uint256 amount, bytes32 sourceChain, address recipient) external {
        emit TokensMinted(token, amount, sourceChain, recipient);
    }

    function burnAndRelease(address token, uint256 amount, bytes32 sourceChain) external {
        emit TokensMinted(token, amount, sourceChain, msg.sender);
    }

    function lockAndSend1155(address token, uint256 tokenId, uint256 amount, bytes32 destinationChain, address recipient) external {
        emit TokensLocked1155(token, tokenId, amount, destinationChain, recipient);
    }

    function burnAndRelease1155(address token, uint256 tokenId, uint256 amount, bytes32 sourceChain) external {
        emit TokensMinted1155(token, tokenId, amount, sourceChain, msg.sender);
    }
}
