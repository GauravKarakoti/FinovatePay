// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title TreasuryManager
 * @notice Basic upgradeable treasury for protocol-level fund management.
 * @dev UUPS upgradeable pattern. Multi-sig and governance hooks are left
 * as higher-level integrations; this contract exposes events and simple
 * on-chain accounting for fees, budgets and withdrawals.
 */
contract TreasuryManager is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    // Budget categories
    mapping(bytes32 => uint256) public budgets; // category -> allocated amount

    // Collected fees per token (token address 0x0 = native)
    mapping(address => uint256) public collected;

    // Multi-sig / governance address (for integration)
    address public governance;

    // Events
    event FeeCollected(address indexed token, address indexed payer, uint256 amount, uint256 total);
    event WithdrawalRequested(address indexed token, address indexed to, uint256 amount, address indexed requester);
    event WithdrawalExecuted(address indexed token, address indexed to, uint256 amount, address indexed by);
    event BudgetAllocated(bytes32 indexed category, uint256 amount, address indexed by);
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner, address _governance) public initializer {
        require(_owner != address(0), "Owner cannot be the zero address");
        __Ownable_init(_owner);
        governance = _governance;
    }

    // Accept native fees
    receive() external payable {
        collected[address(0)] += msg.value;
        emit FeeCollected(address(0), msg.sender, msg.value, collected[address(0)]);
    }

    // Collect ERC20 fee to treasury
    function collectFee(address token, uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        collected[token] += amount;
        emit FeeCollected(token, msg.sender, amount, collected[token]);
    }

    // Allocate budget to a category (only owner/governance integration)
    function allocateBudget(bytes32 category, uint256 amount) external onlyOwner {
        budgets[category] += amount;
        emit BudgetAllocated(category, amount, msg.sender);
    }

    // Request withdrawal (off-chain governance should approve then call executeWithdrawal)
    function requestWithdrawal(address token, address to, uint256 amount) external onlyOwner {
        require(amount > 0, "Invalid amount");
        emit WithdrawalRequested(token, to, amount, msg.sender);
    }

    // Execute withdrawal (for now restricted to owner; multisig integration can call via proxy)
    function executeWithdrawal(address token, address payable to, uint256 amount) external onlyOwner {
        require(amount > 0, "Invalid amount");
        if (token == address(0)) {
            require(address(this).balance >= amount, "Insufficient native balance");
            (bool ok,) = to.call{value: amount}("");
            require(ok, "Native transfer failed");
        } else {
            uint256 bal = IERC20(token).balanceOf(address(this));
            require(bal >= amount, "Insufficient token balance");
            IERC20(token).safeTransfer(to, amount);
        }

        // Deduct from collected if possible
        if (collected[token] >= amount) {
            collected[token] -= amount;
        }

        emit WithdrawalExecuted(token, to, amount, msg.sender);
    }

    function setGovernance(address _governance) external onlyOwner {
        emit GovernanceUpdated(governance, _governance);
        governance = _governance;
    }

    // Read helper for on-chain reporting
    function getCollected(address token) external view returns (uint256) {
        return collected[token];
    }

    function getBudget(bytes32 category) external view returns (uint256) {
        return budgets[category];
    }

    // UUPS Authorization
    function _authorizeUpgrade(address) internal view override onlyOwner {}
}
