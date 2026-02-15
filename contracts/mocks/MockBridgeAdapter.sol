// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockBridgeAdapter {
    bytes32 public constant KATANA_CHAIN = keccak256("katana");

    event Locked(bytes32 lockId);
    event Bridged(bytes32 lockId);
    event AggLayerTransfer(bytes32 destinationChain);

    function lockERC1155ForBridge(
        address,
        uint256,
        uint256,
        bytes32
    ) external returns (bytes32) {
        bytes32 lockId = keccak256(abi.encodePacked(block.timestamp, msg.sender));
        emit Locked(lockId);
        return lockId;
    }

    function bridgeERC1155Asset(bytes32 lockId, address) external {
        emit Bridged(lockId);
    }

    function aggLayerTransferERC1155(
        address,
        uint256,
        uint256,
        bytes32 destinationChain,
        address,
        address
    ) external {
        emit AggLayerTransfer(destinationChain);
    }
}
