// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title IRevolvingCreditLine
 * @dev Interface for the Revolving Credit Line contract
 */
interface IRevolvingCreditLine {
    struct CreditLine {
        address borrower;
        uint256 creditLimit;
        uint256 drawnAmount;
        uint256 interestRate; // Annual rate in bps (e.g., 500 = 5%)
        uint256 lastAccrualTime;
        uint256 collateralTokenId;
        uint256 collateralAmount;
        bool isActive;
        bool isCollateralLocked;
    }

    event CreditLineCreated(
        bytes32 indexed creditLineId,
        address indexed borrower,
        uint256 creditLimit,
        uint256 interestRate
    );
    event Drawdown(
        bytes32 indexed creditLineId,
        address indexed borrower,
        uint256 amount,
        uint256 newDrawnAmount
    );
    event Repayment(
        bytes32 indexed creditLineId,
        address indexed borrower,
        uint256 amount,
        uint256 newDrawnAmount,
        uint256 interestPaid
    );
    event CollateralDeposited(
        bytes32 indexed creditLineId,
        address indexed borrower,
        uint256 tokenId,
        uint256 amount
    );
    event CollateralWithdrawn(
        bytes32 indexed creditLineId,
        address indexed borrower,
        uint256 tokenId,
        uint256 amount
    );
    event CreditLineClosed(
        bytes32 indexed creditLineId,
        address indexed borrower
    );
    event CreditLimitUpdated(
        bytes32 indexed creditLineId,
        uint256 newCreditLimit
    );

    function createCreditLine(
        uint256 _creditLimit,
        uint256 _interestRate,
        uint256 _collateralTokenId,
        uint256 _collateralAmount
    ) external returns (bytes32);

    function drawdown(bytes32 _creditLineId, uint256 _amount) external returns (bool);

    function repay(bytes32 _creditLineId, uint256 _amount) external returns (bool);

    function depositCollateral(
        bytes32 _creditLineId,
        uint256 _tokenId,
        uint256 _amount
    ) external returns (bool);

    function withdrawCollateral(
        bytes32 _creditLineId,
        uint256 _amount
    ) external returns (bool);

    function closeCreditLine(bytes32 _creditLineId) external returns (bool);

    function getCreditLine(bytes32 _creditLineId) external view returns (CreditLine memory);

    function getCreditLineByBorrower(address _borrower) external view returns (bytes32);

    function calculateInterest(bytes32 _creditLineId) external view returns (uint256);

    function getAvailableCredit(bytes32 _creditLineId) external view returns (uint256);
}

/**
 * @title RevolvingCreditLine
 * @author FinovatePay Team
 * @notice Manages on-chain revolving credit lines with collateralized ERC1155 tokens
 */
contract RevolvingCreditLine is IRevolvingCreditLine, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Interfaces
    IERC20 public stablecoin;
    IERC1155 public fractionToken;

    // Configuration
    uint256 public constant MIN_CREDIT_SCORE = 60; // Minimum credit score to qualify
    uint256 public constant COLLATERALIZATION_RATIO = 150; // 150% collateral required
    uint256 public constant BASE_RATE = 10000; // BPS base
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    // Credit Score to Credit Limit Multiplier (1 point = 100 USD)
    uint256 public creditScoreMultiplier = 100e18; // $100 per credit point

    // Mappings
    mapping(bytes32 => CreditLine) public creditLines;
    mapping(address => bytes32) public borrowerToCreditLine;
    mapping(address => uint256) public userCreditScores;

    // Events
    event CreditScoreUpdated(address indexed user, uint256 newScore);
    event CreditScoreMultiplierUpdated(uint256 newMultiplier);
    event StablecoinUpdated(address newStablecoin);
    event FractionTokenUpdated(address newFractionToken);

    constructor(address _stablecoin, address _fractionToken) Ownable(msg.sender) {
        require(_stablecoin != address(0), "Invalid stablecoin address");
        require(_fractionToken != address(0), "Invalid fraction token address");
        stablecoin = IERC20(_stablecoin);
        fractionToken = IERC1155(_fractionToken);
    }

    /**
     * @notice Update the stablecoin address
     */
    function setStablecoin(address _stablecoin) external onlyOwner {
        require(_stablecoin != address(0), "Invalid stablecoin address");
        stablecoin = IERC20(_stablecoin);
        emit StablecoinUpdated(_stablecoin);
    }

    /**
     * @notice Update the fraction token address
     */
    function setFractionToken(address _fractionToken) external onlyOwner {
        require(_fractionToken != address(0), "Invalid fraction token address");
        fractionToken = IERC1155(_fractionToken);
        emit FractionTokenUpdated(_fractionToken);
    }

    /**
     * @notice Update credit score multiplier
     */
    function setCreditScoreMultiplier(uint256 _multiplier) external onlyOwner {
        require(_multiplier > 0, "Multiplier must be positive");
        creditScoreMultiplier = _multiplier;
        emit CreditScoreMultiplierUpdated(_multiplier);
    }

    /**
     * @notice Update user's credit score (called from backend)
     */
    function updateCreditScore(address _user, uint256 _score) external onlyOwner {
        require(_user != address(0), "Invalid user address");
        require(_score <= 100, "Score must be 0-100");
        userCreditScores[_user] = _score;
        emit CreditScoreUpdated(_user, _score);
    }

    /**
     * @notice Calculate credit limit based on credit score
     */
    function calculateCreditLimit(uint256 _creditScore) public view returns (uint256) {
        if (_creditScore < MIN_CREDIT_SCORE) {
            return 0; // Not qualified
        }
        // Linear formula: score * multiplier
        // Score 60 = $6000, Score 100 = $10000
        return _creditScore * creditScoreMultiplier;
    }

    /**
     * @notice Create a new credit line
     */
    function createCreditLine(
        uint256 _creditLimit,
        uint256 _interestRate,
        uint256 _collateralTokenId,
        uint256 _collateralAmount
    ) external override nonReentrant returns (bytes32) {
        require(_creditLimit > 0, "Credit limit must be positive");
        require(_interestRate > 0 && _interestRate < 2000, "Interest rate must be 0-20%");
        require(_collateralAmount > 0, "Collateral required");

        // Check user has sufficient credit score
        uint256 userScore = userCreditScores[msg.sender];
        require(userScore >= MIN_CREDIT_SCORE, "Credit score too low");

        // Verify collateral value meets requirement
        uint256 minCollateral = (_creditLimit * COLLATERALIZATION_RATIO) / 100;
        require(_collateralAmount >= minCollateral, "Insufficient collateral");

        // Ensure user doesn't already have a credit line
        require(borrowerToCreditLine[msg.sender] == bytes32(0), "Credit line exists");

        // Generate unique credit line ID
        bytes32 creditLineId = keccak256(
            abi.encodePacked(msg.sender, _creditLimit, block.timestamp)
        );

        // Transfer collateral to contract
        fractionToken.safeTransferFrom(
            msg.sender,
            address(this),
            _collateralTokenId,
            _collateralAmount,
            ""
        );

        // Create credit line
        creditLines[creditLineId] = CreditLine({
            borrower: msg.sender,
            creditLimit: _creditLimit,
            drawnAmount: 0,
            interestRate: _interestRate,
            lastAccrualTime: block.timestamp,
            collateralTokenId: _collateralTokenId,
            collateralAmount: _collateralAmount,
            isActive: true,
            isCollateralLocked: false
        });

        borrowerToCreditLine[msg.sender] = creditLineId;

        emit CreditLineCreated(creditLineId, msg.sender, _creditLimit, _interestRate);
        emit CollateralDeposited(creditLineId, msg.sender, _collateralTokenId, _collateralAmount);

        return creditLineId;
    }

    /**
     * @notice Draw funds from credit line
     */
    function drawdown(bytes32 _creditLineId, uint256 _amount)
        external
        override
        nonReentrant
        returns (bool)
    {
        CreditLine storage cl = creditLines[_creditLineId];
        require(cl.isActive, "Credit line not active");
        require(cl.borrower == msg.sender, "Not borrower");
        require(_amount > 0, "Amount must be positive");

        // Calculate available credit
        uint256 available = getAvailableCredit(_creditLineId);
        require(available >= _amount, "Insufficient credit");

        // Accrue interest before drawdown
        uint256 accruedInterest = calculateInterest(_creditLineId);
        require(accruedInterest == 0 || stablecoin.balanceOf(msg.sender) >= accruedInterest, "Interest must be paid first");

        // Update drawn amount
        cl.drawnAmount += _amount;
        cl.lastAccrualTime = block.timestamp;

        // Transfer funds to borrower
        stablecoin.safeTransfer(msg.sender, _amount);

        emit Drawdown(_creditLineId, msg.sender, _amount, cl.drawnAmount);
        return true;
    }

    /**
     * @notice Repay funds to credit line
     */
    function repay(bytes32 _creditLineId, uint256 _amount)
        external
        override
        nonReentrant
        returns (bool)
    {
        CreditLine storage cl = creditLines[_creditLineId];
        require(cl.isActive, "Credit line not active");
        require(cl.borrower == msg.sender, "Not borrower");
        require(_amount > 0, "Amount must be positive");

        // Calculate total debt (principal + interest)
        uint256 accruedInterest = calculateInterest(_creditLineId);
        uint256 totalDebt = cl.drawnAmount + accruedInterest;

        // Determine payment amount
        uint256 paymentAmount = _amount > totalDebt ? totalDebt : _amount;
        uint256 interestPaid = 0;
        uint256 principalPaid = 0;

        // Transfer payment from borrower
        stablecoin.safeTransferFrom(msg.sender, address(this), paymentAmount);

        // First apply to interest, then principal
        if (accruedInterest > 0) {
            if (paymentAmount >= accruedInterest) {
                interestPaid = accruedInterest;
                principalPaid = paymentAmount - accruedInterest;
            } else {
                interestPaid = paymentAmount;
                principalPaid = 0;
            }
        } else {
            principalPaid = paymentAmount;
        }

        // Update drawn amount
        cl.drawnAmount -= principalPaid;
        cl.lastAccrualTime = block.timestamp;

        // If fully repaid, mark as available for withdrawal
        if (cl.drawnAmount == 0 && accruedInterest == 0) {
            cl.isCollateralLocked = false;
        }

        emit Repayment(_creditLineId, msg.sender, paymentAmount, cl.drawnAmount, interestPaid);
        return true;
    }

    /**
     * @notice Deposit additional collateral
     */
    function depositCollateral(
        bytes32 _creditLineId,
        uint256 _tokenId,
        uint256 _amount
    ) external override nonReentrant returns (bool) {
        CreditLine storage cl = creditLines[_creditLineId];
        require(cl.isActive, "Credit line not active");
        require(cl.borrower == msg.sender, "Not borrower");
        require(_amount > 0, "Amount must be positive");

        // Transfer collateral from borrower
        fractionToken.safeTransferFrom(
            msg.sender,
            address(this),
            _tokenId,
            _amount,
            ""
        );

        // Update collateral
        if (_tokenId == cl.collateralTokenId) {
            cl.collateralAmount += _amount;
        } else {
            // New collateral type
            cl.collateralTokenId = _tokenId;
            cl.collateralAmount = _amount;
        }

        emit CollateralDeposited(_creditLineId, msg.sender, _tokenId, _amount);
        return true;
    }

    /**
     * @notice Withdraw excess collateral (when drawnAmount is low enough)
     */
    function withdrawCollateral(bytes32 _creditLineId, uint256 _amount)
        external
        override
        nonReentrant
        returns (bool)
    {
        CreditLine storage cl = creditLines[_creditLineId];
        require(cl.isActive, "Credit line not active");
        require(cl.borrower == msg.sender, "Not borrower");
        require(_amount > 0, "Amount must be positive");

        // Check if collateral can be withdrawn (must maintain ratio)
        uint256 minCollateral = (cl.drawnAmount * COLLATERALIZATION_RATIO) / 100;
        require(cl.collateralAmount - _amount >= minCollateral, "Below minimum collateral");

        // Transfer collateral back to borrower
        fractionToken.safeTransferFrom(
            address(this),
            msg.sender,
            cl.collateralTokenId,
            _amount,
            ""
        );

        cl.collateralAmount -= _amount;

        emit CollateralWithdrawn(_creditLineId, msg.sender, cl.collateralTokenId, _amount);
        return true;
    }

    /**
     * @notice Close credit line (must be fully repaid)
     */
    function closeCreditLine(bytes32 _creditLineId) external override returns (bool) {
        CreditLine storage cl = creditLines[_creditLineId];
        require(cl.isActive, "Credit line not active");
        require(cl.borrower == msg.sender, "Not borrower");
        require(cl.drawnAmount == 0, "Must repay fully first");

        // Return collateral
        fractionToken.safeTransferFrom(
            address(this),
            msg.sender,
            cl.collateralTokenId,
            cl.collateralAmount,
            ""
        );

        // Deactivate credit line
        cl.isActive = false;
        delete borrowerToCreditLine[msg.sender];

        emit CreditLineClosed(_creditLineId, msg.sender);
        return true;
    }

    /**
     * @notice Get credit line details
     */
    function getCreditLine(bytes32 _creditLineId)
        external
        view
        override
        returns (CreditLine memory)
    {
        return creditLines[_creditLineId];
    }

    /**
     * @notice Get credit line ID by borrower address
     */
    function getCreditLineByBorrower(address _borrower)
        external
        view
        override
        returns (bytes32)
    {
        return borrowerToCreditLine[_borrower];
    }

    /**
     * @notice Calculate accrued interest
     */
    function calculateInterest(bytes32 _creditLineId)
        public
        view
        override
        returns (uint256)
    {
        CreditLine storage cl = creditLines[_creditLineId];
        if (cl.drawnAmount == 0) {
            return 0;
        }

        uint256 timeElapsed = block.timestamp - cl.lastAccrualTime;
        if (timeElapsed == 0) {
            return 0;
        }

        // Interest = Principal * Rate * Time / (BASE * SECONDS_PER_YEAR)
        // Rate is in BPS, so divide by BASE_RATE (10000)
        uint256 interest = (cl.drawnAmount * cl.interestRate * timeElapsed) /
            (BASE_RATE * SECONDS_PER_YEAR);

        return interest;
    }

    /**
     * @notice Get available credit (creditLimit - drawnAmount - interest)
     */
    function getAvailableCredit(bytes32 _creditLineId)
        public
        view
        override
        returns (uint256)
    {
        CreditLine storage cl = creditLines[_creditLineId];
        if (!cl.isActive) {
            return 0;
        }

        uint256 accruedInterest = calculateInterest(_creditLineId);
        uint256 usedCredit = cl.drawnAmount + accruedInterest;

        if (usedCredit >= cl.creditLimit) {
            return 0;
        }

        return cl.creditLimit - usedCredit;
    }

    /**
     * @notice Get total debt (principal + interest)
     */
    function getTotalDebt(bytes32 _creditLineId) external view returns (uint256) {
        CreditLine storage cl = creditLines[_creditLineId];
        return cl.drawnAmount + calculateInterest(_creditLineId);
    }

    /**
     * @notice Emergency withdraw (admin only)
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    /**
     * @notice Withdraw accumulated interest to fee wallet
     */
    function withdrawInterest(address _feeWallet, uint256 _amount) external onlyOwner {
        require(_feeWallet != address(0), "Invalid fee wallet");
        stablecoin.safeTransfer(_feeWallet, _amount);
    }
}
