// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockEscrowContract {
    bytes32 public lastInvoiceId;

    function createEscrow(
        bytes32 invoiceId,
        address,
        address,
        uint256,
        address,
        uint256,
        address,
        uint256
    ) external {
        lastInvoiceId = invoiceId;
    }

    function confirmRelease(bytes32) external {}
}
