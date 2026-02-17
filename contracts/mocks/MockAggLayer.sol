// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockAggLayer {
    event MessageSent(bytes32 indexed destinationChain, address indexed destinationContract, bytes data);
    event MessageReceived(bytes32 indexed sourceChain, address indexed sourceContract, bytes data);

    function sendMessage(bytes32 destinationChain, address destinationContract, bytes calldata data) external {
        emit MessageSent(destinationChain, destinationContract, data);
    }

    function receiveMessage(bytes32 sourceChain, address sourceContract, bytes calldata data) external {
        emit MessageReceived(sourceChain, sourceContract, data);
    }
}
