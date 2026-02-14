// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockLiquidityAdapter {
    uint256 public availableLiquidity = type(uint256).max;

    function getAvailableLiquidity(address) external view returns (uint256) {
        return availableLiquidity;
    }

    function borrowFromPool(address, uint256 amount, address borrower) external returns (bytes32) {
        return keccak256(abi.encodePacked(amount, borrower, block.timestamp));
    }

    function repayToPool(bytes32) external {}
}
