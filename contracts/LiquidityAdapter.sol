// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ComplianceManager.sol";

interface ILiquidityPool {
    function borrow(address asset, uint256 amount, address recipient) external returns (bool);
    function repay(address asset, uint256 amount, address borrower) external returns (bool);
    function getBorrowRate(address asset) external view returns (uint256);
    function getAvailableLiquidity(address asset) external view returns (uint256);
}

interface IWaltBridge {
    function lockAndSend(address token, uint256 amount, bytes32 destinationChain, address recipient) external;
    function burnAndRelease(address token, uint256 amount, bytes32 sourceChain) external;
}

contract LiquidityAdapter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IWaltBridge public waltBridge;
    ComplianceManager public complianceManager;

    // Supported chains
    bytes32 public constant FINOVATE_CHAIN = keccak256("finovate-cdk");
    bytes32 public constant KATANA_CHAIN = keccak256("katana");

    // Mapping of assets to liquidity pools on Katana
    mapping(address => address) public liquidityPools;

    // Mapping for active loans
    struct Loan {
        address borrower;
        address asset;
        uint256 amount;
        uint256 borrowRate;
        uint256 timestamp;
        bool active;
    }
    mapping(bytes32 => Loan) public loans;

    event LoanInitiated(bytes32 indexed loanId, address borrower, address asset, uint256 amount, uint256 rate);
    event LoanRepaid(bytes32 indexed loanId, address borrower, address asset, uint256 amount);
    event LiquidityPoolUpdated(address indexed asset, address pool);

    modifier onlyCompliant(address _account) {
        require(!complianceManager.isFrozen(_account), "Account frozen");
        require(complianceManager.isKYCVerified(_account), "KYC not verified");
        _;
    }

    constructor(address _waltBridge, address _complianceManager) Ownable(msg.sender) {
        waltBridge = IWaltBridge(_waltBridge);
        complianceManager = ComplianceManager(_complianceManager);
    }

    // Borrow from Katana liquidity pool
    function borrowFromPool(address asset, uint256 amount, address borrower) external onlyOwner onlyCompliant(borrower) nonReentrant returns (bytes32) {
        address pool = liquidityPools[asset];
        require(pool != address(0), "No pool for asset");

        ILiquidityPool katanaPool = ILiquidityPool(pool);
        uint256 availableLiquidity = katanaPool.getAvailableLiquidity(asset);
        require(availableLiquidity >= amount, "Insufficient liquidity");

        uint256 rate = katanaPool.getBorrowRate(asset);

        // Borrow from pool
        require(katanaPool.borrow(asset, amount, borrower), "Borrow failed");

        bytes32 loanId = keccak256(abi.encodePacked(asset, amount, borrower, block.timestamp));
        loans[loanId] = Loan(borrower, asset, amount, rate, block.timestamp, true);

        emit LoanInitiated(loanId, borrower, asset, amount, rate);
        return loanId;
    }

    // Repay loan to Katana liquidity pool
    function repayToPool(bytes32 loanId) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan not active");
        require(loan.borrower == msg.sender, "Not loan borrower");

        address pool = liquidityPools[loan.asset];
        require(pool != address(0), "No pool for asset");

        ILiquidityPool katanaPool = ILiquidityPool(pool);

        // Calculate repayment amount (principal + interest)
        uint256 timeElapsed = block.timestamp - loan.timestamp;
        uint256 interest = (loan.amount * loan.borrowRate * timeElapsed) / (365 days * 1e18); // Assuming rate is in ray (1e27)
        uint256 totalRepayment = loan.amount + interest;

        // Transfer repayment from borrower
        IERC20(loan.asset).safeTransferFrom(msg.sender, address(this), totalRepayment);

        // Approve and repay to pool
        IERC20(loan.asset).safeApprove(pool, totalRepayment);
        require(katanaPool.repay(loan.asset, totalRepayment, msg.sender), "Repay failed");

        loan.active = false;
        emit LoanRepaid(loanId, msg.sender, loan.asset, totalRepayment);
    }

    // Get borrow rate for an asset
    function getBorrowRate(address asset) external view returns (uint256) {
        address pool = liquidityPools[asset];
        if (pool == address(0)) return 0;
        return ILiquidityPool(pool).getBorrowRate(asset);
    }

    // Get available liquidity for an asset
    function getAvailableLiquidity(address asset) external view returns (uint256) {
        address pool = liquidityPools[asset];
        if (pool == address(0)) return 0;
        return ILiquidityPool(pool).getAvailableLiquidity(asset);
    }

    // Set liquidity pool for an asset
    function setLiquidityPool(address asset, address pool) external onlyOwner {
        liquidityPools[asset] = pool;
        emit LiquidityPoolUpdated(asset, pool);
    }

    // Update WaltBridge address
    function updateWaltBridge(address _waltBridge) external onlyOwner {
        waltBridge = IWaltBridge(_waltBridge);
    }

    // Emergency withdraw (admin only)
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }
}
