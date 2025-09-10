// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Invoice.sol";

contract InvoiceFactory {
    address public owner;

    event InvoiceCreated(
        bytes32 indexed invoiceId,
        address invoiceContractAddress,
        address indexed seller,
        address indexed buyer,
        address tokenAddress
    );

    mapping(bytes32 => address) public invoiceContracts;

    constructor() {
        owner = msg.sender;
    }

    function createInvoice(
        bytes32 _invoiceId,
        bytes32 _invoiceHash,
        address _buyer,
        uint256 _amount,
        uint256 _dueDate,
        address _tokenAddress
    ) external returns (address) {
        require(invoiceContracts[_invoiceId] == address(0), "Invoice ID already exists");

        // The factory owner (your backend wallet) acts as the arbiter
        Invoice newInvoice = new Invoice(
            msg.sender, _buyer, owner, _amount, _invoiceHash, _dueDate, _tokenAddress
        );
        
        address newInvoiceAddress = address(newInvoice);
        invoiceContracts[_invoiceId] = newInvoiceAddress;

        emit InvoiceCreated(_invoiceId, newInvoiceAddress, msg.sender, _buyer, _tokenAddress);

        return newInvoiceAddress;
    }

    function getInvoiceAddress(bytes32 _invoiceId) external view returns (address) {
        return invoiceContracts[_invoiceId];
    }
}