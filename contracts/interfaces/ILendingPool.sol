// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ILendingPool
 * @dev Interface for the Dynamic Collateralized Lending Pool
 * @notice Allows borrowing against invoice fractions (ERC1155) and escrow deposits
 */
interface ILendingPool {
    // Enums
    enum LoanStatus {
        Active,
        Repaid,
        Liquidated,
        Defaulted
    }

    enum CollateralType {
        FractionToken,    // ERC1155 invoice fractions
        EscrowDeposit     // Escrow contract deposits
    }

    // Structs
    struct Loan {
        bytes32 loanId;
        address borrower;
        uint256 principal;
        uint256 interestRate; // Annual rate in bps
        uint256 totalDebt;
        uint256 collateralValue;
        uint256 ltv; // Loan-to-value ratio in basis points
        uint256 createdAt;
        uint256 maturityDate;
        LoanStatus status;
        bool isUndercollateralized;
    }

    struct CollateralPosition {
        bytes32 positionId;
        bytes32 loanId;
        address owner;
        CollateralType collateralType;
        address tokenContract;
        uint256 tokenId;
        uint256 amount;
        uint256 value;
        uint256 depositedAt;
        bool isLocked;
    }

    // Events
    event LoanCreated(
        bytes32 indexed loanId,
        address indexed borrower,
        uint256 principal,
        uint256 interestRate,
        uint256 ltv
    );

    event CollateralDeposited(
        bytes32 indexed loanId,
        address indexed borrower,
        CollateralType collateralType,
        address tokenContract,
        uint256 tokenId,
        uint256 amount,
        uint256 value
    );

    event CollateralWithdrawn(
        bytes32 indexed loanId,
        address indexed borrower,
        uint256 amount,
        uint256 remainingValue
    );

    event Borrowed(
        bytes32 indexed loanId,
        address indexed borrower,
        uint256 amount,
        uint256 newTotalDebt
    );

    event Repaid(
        bytes32 indexed loanId,
        address indexed borrower,
        uint256 amount,
        uint256 interestPaid,
        uint256 remainingDebt
    );

    event Liquidated(
        bytes32 indexed loanId,
        address indexed liquidator,
        uint256 collateralSeized,
        uint256 debtCovered,
        uint256 bonus
    );

    event LTVUpdated(
        bytes32 indexed loanId,
        uint256 oldLTV,
        uint256 newLTV
    );

    event Undercollateralized(
        bytes32 indexed loanId,
        address indexed borrower,
        uint256 collateralValue,
        uint256 requiredCollateral
    );

    // Core Functions
    function createLoan(
        uint256 principal,
        uint256 interestRate,
        uint256 collateralTokenId,
        uint256 collateralAmount,
        uint256 collateralValue,
        uint256 loanDuration
    ) external returns (bytes32);

    function depositCollateral(
        bytes32 loanId,
        CollateralType collateralType,
        address tokenContract,
        uint256 tokenId,
        uint256 amount,
        uint256 value
    ) external returns (bytes32);

    function withdrawCollateral(
        bytes32 loanId,
        uint256 amount,
        uint256 value
    ) external returns (bool);

    function borrow(bytes32 loanId, uint256 amount) external returns (bool);

    function repay(bytes32 loanId, uint256 amount) external returns (bool);

    function liquidate(bytes32 loanId) external returns (bool);

    // View Functions
    function calculateLTV(
        address borrower,
        uint256 collateralValue,
        uint256 requestedAmount
    ) external view returns (uint256);

    function getLoan(bytes32 loanId) external view returns (Loan memory);

    function getCollateralPosition(bytes32 positionId) 
        external view returns (CollateralPosition memory);

    function getLoanCollateralPositions(bytes32 loanId) 
        external view returns (CollateralPosition[] memory);

    function getBorrowerLoans(address borrower) 
        external view returns (bytes32[] memory);

    function getMaxBorrowAmount(bytes32 loanId) external view returns (uint256);

    function getTotalPoolValue() external view returns (uint256);

    function getPoolUtilization() external view returns (uint256);

    // Admin Functions
    function setCreditRiskOracle(address oracle) external;

    function setLiquidationThreshold(uint256 threshold) external;

    function setMinCollateralRatio(uint256 ratio) external;

    function setPoolParameters(
        uint256 _minLoanSize,
        uint256 _maxLoanSize,
        uint256 _maxLoanDuration,
        uint256 _baseInterestRate
    ) external;
}

