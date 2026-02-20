// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Invoice is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public seller;
    address public buyer;
    address public arbiter; // Admin for dispute resolution
    uint256 public amount;
    address public tokenAddress;

    // Renamed Status enum for clarity
    enum Status { Unpaid, Deposited, Released, Disputed, Cancelled }
    Status public currentStatus;

    event InvoiceDeposited(uint256 amount);
    event InvoiceReleased(uint256 amount);
    event DisputeRaised(address indexed raisedBy);
    event DisputeResolved(address indexed resolver, address indexed winner);
    event StatusChanged(Status newStatus);

    modifier onlyBuyer() { require(msg.sender == buyer, "Only buyer can call this"); _; }
    modifier onlyArbiter() { require(msg.sender == arbiter, "Only arbiter can call this"); _; }
    modifier inStatus(Status _status) { require(currentStatus == _status, "Invalid status"); _; }

    constructor(
        address _seller,
        address _buyer,
        address _arbiter,
        uint256 _amount,
        bytes32, // invoiceHash - removed from storage to save gas
        uint256, // dueDate - removed from storage to save gas
        address _tokenAddress
    ) {
        seller = _seller;
        buyer = _buyer;
        arbiter = _arbiter;
        amount = _amount;
        tokenAddress = _tokenAddress;
        currentStatus = Status.Unpaid;
    }

    // Buyer deposits funds into this contract
    function depositNative() external payable onlyBuyer inStatus(Status.Unpaid) nonReentrant {
        require(tokenAddress == address(0), "Invoice is for ERC20 token");
        require(msg.value == amount, "Incorrect amount");

        // Update mapping
        escrowBalance[0] += msg.value;

        currentStatus = Status.Deposited;
        emit InvoiceDeposited(msg.value);
        emit StatusChanged(Status.Deposited);
    }

    mapping(uint => uint) public escrowBalance;

    // Buyer deposits ERC20 tokens into this contract
    function depositToken() external onlyBuyer inStatus(Status.Unpaid) nonReentrant {
        require(tokenAddress != address(0), "Invoice is for native currency");
        IERC20 token = IERC20(tokenAddress);
        // FIX: Hold funds in contract instead of transferring directly to seller
        token.safeTransferFrom(msg.sender, address(this), amount);

        // Update mapping as per requirement (using 0 as ID since this is a single invoice contract)
        escrowBalance[0] += amount;

        currentStatus = Status.Deposited;
        emit InvoiceDeposited(amount);
        emit StatusChanged(Status.Deposited);
    }

    // Buyer releases the funds from this contract to the seller
    function releaseFunds() external onlyBuyer inStatus(Status.Deposited) nonReentrant {
        // Clear balance mapping before transfer (reentrancy protection pattern)
        escrowBalance[0] = 0;

        if (tokenAddress == address(0)) {
            (bool success, ) = payable(seller).call{value: amount}("");
            require(success, "Native transfer failed");
        } else {
            IERC20(tokenAddress).safeTransfer(seller, amount);
        }
        currentStatus = Status.Released;
        emit InvoiceReleased(amount);
        emit StatusChanged(Status.Released);
    }

    function raiseDispute() external inStatus(Status.Deposited) {
        require(msg.sender == buyer || msg.sender == seller, "Only parties can raise dispute");
        currentStatus = Status.Disputed;
        emit DisputeRaised(msg.sender);
        emit StatusChanged(Status.Disputed);
    }

    function resolveDispute(address winner) external onlyArbiter inStatus(Status.Disputed) nonReentrant {
        require(winner == buyer || winner == seller, "Winner must be buyer or seller");
        if (tokenAddress == address(0)) {
            (bool success, ) = winner.call{value: amount}("");
            require(success, "Native transfer failed");
        } else {
            IERC20(tokenAddress).safeTransfer(winner, amount);
        }
        currentStatus = Status.Released;
        emit DisputeResolved(msg.sender, winner);
        emit StatusChanged(Status.Released);
    }
}