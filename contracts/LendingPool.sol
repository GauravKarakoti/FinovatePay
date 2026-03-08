// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";

import "./interfaces/ILendingPool.sol";

/**
 * @title LendingPool
 * @author FinovatePay Team
 * @notice Dynamic Collateralized Lending Protocol
 * @dev Allows borrowing against invoice fractions (ERC1155) and escrow deposits
 *      with dynamic LTV based on credit risk assessment
 */
contract LendingPool is 
    ILendingPool, 
    Initializable, 
    UUPSUpgradeable, 
    OwnableUpgradeable, 
    ReentrancyGuard,
    PausableUpgradeable,
    ERC2771ContextUpgradeable 
{
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                            CONSTANTS
    //////////////////////////////////////////////////////////////*/
    
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MIN_CREDIT_SCORE = 60;
    
    /*//////////////////////////////////////////////////////////////
                            STATE VARIABLES
    //////////////////////////////////////////////////////////////*/

    // Token Contracts
    IERC20 public stablecoin;
    IERC1155 public fractionToken;
    address public escrowContract;
    address public creditRiskOracle;

    // Pool Configuration
    uint256 public minLoanSize;
    uint256 public maxLoanSize;
    uint256 public maxLoanDuration;
    uint256 public baseInterestRate;
    uint256 public liquidationThreshold; // BPS - e.g., 8500 = 85%
    uint256 public minCollateralRatio;   // BPS - e.g., 12000 = 120%
    uint256 public liquidationBonus;      // BPS - bonus for liquidators

    // Risk Adjustment Factors
    uint256 public riskScoreWeight;       // Weight for credit score in LTV (0-100%)
    uint256 public collateralWeight;      // Weight for collateral value in LTV

    // Pool State
    uint256 public totalDeposits;
    uint256 public totalBorrowed;
    uint256 public totalInterestAccrued;

    // Mappings
    mapping(bytes32 => Loan) public loans;
    mapping(bytes32 => CollateralPosition) public collateralPositions;
    mapping(bytes32 => bytes32[]) public loanToCollateralPositions;
    mapping(address => bytes32[]) public borrowerLoans;
    mapping(address => uint256) public userCreditScores;

    // Version
    uint256 public version;
    string public constant CONTRACT_NAME = "LendingPool";

    /*//////////////////////////////////////////////////////////////
                            MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyActiveLoan(bytes32 loanId) {
        require(loans[loanId].status == LoanStatus.Active, "Loan not active");
        _;
    }

    modifier onlyBorrower(bytes32 loanId) {
        require(loans[loanId].borrower == _msgSender(), "Not borrower");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                            EVENTS
    //////////////////////////////////////////////////////////////*/

    event PoolParametersUpdated(
        uint256 minLoanSize,
        uint256 maxLoanSize,
        uint256 maxLoanDuration,
        uint256 baseInterestRate
    );
    
    event RiskParametersUpdated(
        uint256 liquidationThreshold,
        uint256 minCollateralRatio,
        uint256 liquidationBonus,
        uint256 riskScoreWeight
    );
    
    event CreditScoreUpdated(address indexed user, uint256 score);
    event StablecoinUpdated(address newStablecoin);
    event FractionTokenUpdated(address newFractionToken);
    event EscrowContractUpdated(address newEscrowContract);
    event OracleUpdated(address newOracle);

    /*//////////////////////////////////////////////////////////////
                            INITIALIZATION
    //////////////////////////////////////////////////////////////*/

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _trustedForwarder) ERC2771ContextUpgradeable(_trustedForwarder) {
        _disableInitializers();
    }

    function initialize(
        address _trustedForwarder,
        address _stablecoin,
        address _fractionToken,
        address _escrowContract,
        address _owner
    ) external initializer {
        __Ownable_init(_owner);
        __Pausable_init();
        __ReentrancyGuard_init();

        require(_stablecoin != address(0), "Invalid stablecoin");
        require(_fractionToken != address(0), "Invalid fraction token");

        stablecoin = IERC20(_stablecoin);
        fractionToken = IERC1155(_fractionToken);
        escrowContract = _escrowContract;

        // Default pool parameters
        minLoanSize = 1000e6;      // $1,000 (USDC has 6 decimals)
        maxLoanSize = 1000000e6;   // $1,000,000
        maxLoanDuration = 180 days;
        baseInterestRate = 500;    // 5% APR
        liquidationThreshold = 8500; // 85%
        minCollateralRatio = 12000; // 120%
        liquidationBonus = 500;     // 5% bonus
        riskScoreWeight = 30;       // 30% weight for credit score
        collateralWeight = 70;     // 70% weight for collateral

        version = 1;
    }

    /**
     * @notice Upgrade authorization for UUPS proxy
     */
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /*//////////////////////////////////////////////////////////////
                    CORE LENDING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Create a new loan with initial collateral
     * @param principal Amount to borrow in stablecoin decimals
     * @param interestRate Annual interest rate in bps
     * @param collateralTokenId ERC1155 token ID for invoice fractions
     * @param collateralAmount Amount of fraction tokens
     * @param collateralValue USD value of collateral
     * @param loanDuration Duration in seconds
     */
    function createLoan(
        uint256 principal,
        uint256 interestRate,
        uint256 collateralTokenId,
        uint256 collateralAmount,
        uint256 collateralValue,
        uint256 loanDuration
    ) external override nonReentrant whenNotPaused returns (bytes32) {
        require(principal >= minLoanSize, "Principal below minimum");
        require(principal <= maxLoanSize, "Principal exceeds maximum");
        require(loanDuration > 0 && loanDuration <= maxLoanDuration, "Invalid duration");
        require(interestRate > 0 && interestRate < 2000, "Invalid interest rate");
        require(collateralAmount > 0 && collateralValue > 0, "No collateral");

        // Generate unique loan ID
        bytes32 loanId = keccak256(
            abi.encodePacked(
                _msgSender(),
                principal,
                block.timestamp,
                block.number
            )
        );

        // Calculate initial LTV based on credit risk
        uint256 ltv = calculateLTV(_msgSender(), collateralValue, principal);
        
        // Check minimum collateral ratio
        uint256 requiredCollateralRatio = minCollateralRatio;
        
        // Adjust based on credit score
        uint256 creditScore = userCreditScores[_msgSender()];
        if (creditScore >= 80) {
            requiredCollateralRatio = 11000; // 110% for excellent credit
        } else if (creditScore >= 70) {
            requiredCollateralRatio = 11500; // 115% for good credit
        }

        uint256 collateralRatio = (collateralValue * BASIS_POINTS) / principal;
        require(collateralRatio >= requiredCollateralRatio, "Insufficient collateral");

        // Transfer collateral tokens from borrower
        if (collateralTokenId > 0 && collateralAmount > 0) {
            fractionToken.safeTransferFrom(
                _msgSender(),
                address(this),
                collateralTokenId,
                collateralAmount,
                ""
            );
        }

        // Transfer borrowed amount to borrower
        stablecoin.safeTransfer(_msgSender(), principal);

        // Create loan
        loans[loanId] = Loan({
            loanId: loanId,
            borrower: _msgSender(),
            principal: principal,
            interestRate: interestRate,
            totalDebt: principal,
            collateralValue: collateralValue,
            ltv: ltv,
            createdAt: block.timestamp,
            maturityDate: block.timestamp + loanDuration,
            status: LoanStatus.Active,
            isUndercollateralized: false
        });

        // Create initial collateral position
        bytes32 positionId = keccak256(
            abi.encodePacked(loanId, collateralTokenId, block.timestamp)
        );

        collateralPositions[positionId] = CollateralPosition({
            positionId: positionId,
            loanId: loanId,
            owner: _msgSender(),
            collateralType: CollateralType.FractionToken,
            tokenContract: address(fractionToken),
            tokenId: collateralTokenId,
            amount: collateralAmount,
            value: collateralValue,
            depositedAt: block.timestamp,
            isLocked: true
        });

        loanToCollateralPositions[loanId].push(positionId);
        borrowerLoans[_msgSender()].push(loanId);

        // Update pool state
        totalBorrowed += principal;

        emit LoanCreated(loanId, _msgSender(), principal, interestRate, ltv);
        emit CollateralDeposited(
            loanId,
            _msgSender(),
            CollateralType.FractionToken,
            address(fractionToken),
            collateralTokenId,
            collateralAmount,
            collateralValue
        );

        return loanId;
    }

    /**
     * @notice Deposit additional collateral to an existing loan
     */
    function depositCollateral(
        bytes32 loanId,
        CollateralType collateralType,
        address tokenContract,
        uint256 tokenId,
        uint256 amount,
        uint256 value
    ) external override nonReentrant onlyActiveLoan(loanId) onlyBorrower(loanId) returns (bytes32) {
        require(amount > 0 && value > 0, "Invalid amount/value");

        Loan storage loan = loans[loanId];

        // Transfer tokens based on collateral type
        if (collateralType == CollateralType.FractionToken) {
            IERC1155(tokenContract).safeTransferFrom(
                _msgSender(),
                address(this),
                tokenId,
                amount,
                ""
            );
        } else if (collateralType == CollateralType.EscrowDeposit) {
            // For escrow deposits, we verify through the escrow contract
            require(tokenContract == escrowContract, "Invalid escrow contract");
        }

        // Create collateral position
        bytes32 positionId = keccak256(
            abi.encodePacked(loanId, tokenId, block.timestamp, amount)
        );

        collateralPositions[positionId] = CollateralPosition({
            positionId: positionId,
            loanId: loanId,
            owner: _msgSender(),
            collateralType: collateralType,
            tokenContract: tokenContract,
            tokenId: tokenId,
            amount: amount,
            value: value,
            depositedAt: block.timestamp,
            isLocked: true
        });

        loanToCollateralPositions[loanId].push(positionId);

        // Update loan collateral value
        loan.collateralValue += value;

        // Recalculate LTV
        uint256 newLTV = calculateLTV(_msgSender(), loan.collateralValue, loan.totalDebt);
        loan.ltv = newLTV;

        // Check if still undercollateralized
        loan.isUndercollateralized = loan.ltv > liquidationThreshold;

        emit CollateralDeposited(loanId, _msgSender(), collateralType, tokenContract, tokenId, amount, value);
        
        if (loan.isUndercollateralized) {
            emit Undercollateralized(loanId, _msgSender(), loan.collateralValue, (loan.totalDebt * minCollateralRatio) / BASIS_POINTS);
        }

        return positionId;
    }

    /**
     * @notice Withdraw excess collateral from a loan
     */
    function withdrawCollateral(
        bytes32 loanId,
        uint256 amount,
        uint256 value
    ) external override nonReentrant onlyActiveLoan(loanId) onlyBorrower(loanId) returns (bool) {
        require(amount > 0 && value > 0, "Invalid amount/value");

        Loan storage loan = loans[loanId];

        // Calculate remaining collateral after withdrawal
        uint256 remainingCollateralValue = loan.collateralValue - value;
        uint256 requiredCollateral = (loan.totalDebt * minCollateralRatio) / BASIS_POINTS;
        
        require(remainingCollateralValue >= requiredCollateral, "Would undercollateralize");

        // Find and update collateral position
        bytes32[] storage positionIds = loanToCollateralPositions[loanId];
        bool found = false;
        
        for (uint256 i = 0; i < positionIds.length; i++) {
            CollateralPosition storage pos = collateralPositions[positionIds[i]];
            if (pos.owner == _msgSender() && pos.amount >= amount && !pos.isLocked) {
                pos.amount -= amount;
                pos.value -= value;
                
                if (pos.amount == 0) {
                    delete collateralPositions[positionIds[i]];
                    positionIds[i] = positionIds[positionIds.length - 1];
                    positionIds.pop();
                }
                
                // Return tokens
                if (pos.collateralType == CollateralType.FractionToken) {
                    IERC1155(pos.tokenContract).safeTransferFrom(
                        address(this),
                        _msgSender(),
                        pos.tokenId,
                        amount,
                        ""
                    );
                }
                
                found = true;
                break;
            }
        }

        require(found, "No unlocked collateral found");

        // Update loan
        loan.collateralValue -= value;
        loan.ltv = calculateLTV(_msgSender(), loan.collateralValue, loan.totalDebt);
        loan.isUndercollateralized = loan.ltv > liquidationThreshold;

        emit CollateralWithdrawn(loanId, _msgSender(), amount, loan.collateralValue);

        return true;
    }

    /**
     * @notice Borrow additional funds against existing collateral
     */
    function borrow(bytes32 loanId, uint256 amount)
        external
        override
        nonReentrant
        onlyActiveLoan(loanId)
        onlyBorrower(loanId)
        returns (bool)
    {
        require(amount > 0, "Amount must be positive");

        Loan storage loan = loans[loanId];

        // Check max borrow amount
        uint256 maxBorrow = getMaxBorrowAmount(loanId);
        require(amount <= maxBorrow, "Exceeds max borrow");

        // Calculate new LTV after borrow
        uint256 newTotalDebt = loan.totalDebt + amount;
        uint256 newCollateralValue = loan.collateralValue;
        uint256 newLTV = calculateLTV(_msgSender(), newCollateralValue, newTotalDebt);

        // Check collateral ratio after borrow
        uint256 requiredRatio = minCollateralRatio;
        uint256 creditScore = userCreditScores[_msgSender()];
        if (creditScore >= 80) requiredRatio = 11000;
        else if (creditScore >= 70) requiredRatio = 11500;

        uint256 actualRatio = (newCollateralValue * BASIS_POINTS) / newTotalDebt;
        require(actualRatio >= requiredRatio, "Would undercollateralize");

        // Update loan
        uint256 oldLTV = loan.ltv;
        loan.principal += amount;
        loan.totalDebt = newTotalDebt;
        loan.ltv = newLTV;
        loan.isUndercollateralized = newLTV > liquidationThreshold;

        // Transfer funds
        stablecoin.safeTransfer(_msgSender(), amount);

        // Update pool state
        totalBorrowed += amount;

        emit Borrowed(loanId, _msgSender(), amount, loan.totalDebt);
        emit LTVUpdated(loanId, oldLTV, newLTV);

        if (loan.isUndercollateralized) {
            emit Undercollateralized(loanId, _msgSender(), loan.collateralValue, (loan.totalDebt * minCollateralRatio) / BASIS_POINTS);
        }

        return true;
    }

    /**
     * @notice Repay a loan (partial or full)
     */
    function repay(bytes32 loanId, uint256 amount)
        external
        override
        nonReentrant
        onlyActiveLoan(loanId)
        onlyBorrower(loanId)
        returns (bool)
    {
        require(amount > 0, "Amount must be positive");

        Loan storage loan = loans[loanId];

        // Calculate interest
        uint256 interest = calculateInterest(loanId);
        uint256 totalOwed = loan.totalDebt + interest;

        // Determine payment amount
        uint256 paymentAmount = amount > totalOwed ? totalOwed : amount;
        uint256 interestPaid = 0;
        uint256 principalPaid = 0;

        // Transfer payment
        stablecoin.safeTransferFrom(_msgSender(), address(this), paymentAmount);

        // Apply payment: interest first, then principal
        if (paymentAmount >= interest) {
            interestPaid = interest;
            principalPaid = paymentAmount - interest;
        } else {
            interestPaid = paymentAmount;
            principalPaid = 0;
        }

        // Update loan
        uint256 oldTotalDebt = loan.totalDebt;
        loan.totalDebt -= principalPaid;
        totalInterestAccrued += interestPaid;

        // Unlock collateral if fully repaid
        if (loan.totalDebt == 0) {
            loan.status = LoanStatus.Repaid;
            
            // Release collateral positions
            bytes32[] storage positionIds = loanToCollateralPositions[loanId];
            for (uint256 i = 0; i < positionIds.length; i++) {
                collateralPositions[positionIds[i]].isLocked = false;
            }

            // Update pool state
            totalBorrowed -= loan.principal;
        }

        // Recalculate LTV
        if (loan.totalDebt > 0) {
            loan.ltv = calculateLTV(_msgSender(), loan.collateralValue, loan.totalDebt);
            loan.isUndercollateralized = loan.ltv > liquidationThreshold;
        }

        emit Repaid(loanId, _msgSender(), paymentAmount, interestPaid, loan.totalDebt);

        return true;
    }

    /**
     * @notice Liquidate an undercollateralized loan
     */
    function liquidate(bytes32 loanId)
        external
        override
        nonReentrant
        onlyActiveLoan(loanId)
        returns (bool)
    {
        Loan storage loan = loans[loanId];

        // Check if liquidatable
        require(loan.isUndercollateralized || loan.ltv < liquidationThreshold, "Not liquidatable");

        // Calculate liquidation amounts
        uint256 debtCovered = loan.totalDebt;
        
        // Calculate bonus for liquidator
        uint256 bonus = (debtCovered * liquidationBonus) / BASIS_POINTS;
        uint256 totalLiquidationAmount = debtCovered + bonus;

        // Transfer debt from liquidator
        stablecoin.safeTransferFrom(_msgSender(), address(this), debtCovered);

        // Transfer collateral to liquidator
        uint256 collateralSeized = 0;
        bytes32[] storage positionIds = loanToCollateralPositions[loanId];
        
        for (uint256 i = 0; i < positionIds.length; i++) {
            CollateralPosition storage pos = collateralPositions[positionIds[i]];
            if (pos.amount > 0) {
                collateralSeized += pos.value;
                
                if (pos.collateralType == CollateralType.FractionToken) {
                    IERC1155(pos.tokenContract).safeTransferFrom(
                        address(this),
                        _msgSender(),
                        pos.tokenId,
                        pos.amount,
                        ""
                    );
                }
                
                delete collateralPositions[positionIds[i]];
            }
        }

        // Update loan status
        loan.status = LoanStatus.Liquidated;
        loan.totalDebt = 0;

        // Update pool state
        totalBorrowed -= loan.principal;

        emit Liquidated(loanId, _msgSender(), collateralSeized, debtCovered, bonus);

        return true;
    }

    /*//////////////////////////////////////////////////////////////
                        LTV CALCULATION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Calculate dynamic LTV based on credit risk and collateral
     * @dev Uses credit score and collateral value to determine LTV
     */
    function calculateLTV(
        address borrower,
        uint256 collateralValue,
        uint256 requestedAmount
    ) public view override returns (uint256) {
        if (requestedAmount == 0) return 0;
        if (collateralValue == 0) return BASIS_POINTS; // Max LTV when no collateral

        // Base LTV from collateral
        uint256 baseLTV = (collateralValue * BASIS_POINTS) / requestedAmount;
        
        // Cap at maximum
        if (baseLTV > BASIS_POINTS) baseLTV = BASIS_POINTS;

        // Get credit score (0-100)
        uint256 creditScore = userCreditScores[borrower];
        
        // Adjust LTV based on credit score
        // Score >= 80: +10% LTV
        // Score >= 70: +5% LTV
        // Score >= 60: 0% adjustment
        // Score < 60: -20% LTV
        int256 adjustment = 0;
        
        if (creditScore >= 80) {
            adjustment = int256(BASIS_POINTS / 10); // +10%
        } else if (creditScore >= 70) {
            adjustment = int256(BASIS_POINTS / 20); // +5%
        } else if (creditScore < MIN_CREDIT_SCORE) {
            adjustment = -int256(BASIS_POINTS / 5); // -20%
        }

        // Apply weighted adjustment
        int256 weightedAdjustment = (adjustment * int256(int256(riskScoreWeight))) / 100;
        
        // Combine base LTV with credit-based adjustment
        int256 finalLTV = int256(baseLTV) + weightedAdjustment;
        
        // Apply collateral weight
        finalLTV = (finalLTV * int256(int256(collateralWeight))) / 100;

        // Ensure within bounds
        if (finalLTV < 0) return 0;
        if (finalLTV > int256(BASIS_POINTS)) return BASIS_POINTS;
        
        return uint256(finalLTV);
    }

    /**
     * @notice Calculate interest accrued on a loan
     */
    function calculateInterest(bytes32 loanId) public view returns (uint256) {
        Loan storage loan = loans[loanId];
        if (loan.totalDebt == 0) return 0;

        uint256 timeElapsed = block.timestamp - loan.createdAt;
        if (timeElapsed == 0) return 0;

        // Interest = Principal * Rate * Time / (BASIS * SECONDS_PER_YEAR)
        uint256 interest = (loan.totalDebt * loan.interestRate * timeElapsed) /
            (BASIS_POINTS * 365 days);

        return interest;
    }

    /**
     * @notice Get maximum borrowable amount for a loan
     */
    function getMaxBorrowAmount(bytes32 loanId) public view override returns (uint256) {
        Loan storage loan = loans[loanId];
        
        // Calculate max based on current collateral and LTV
        uint256 maxByCollateral = (loan.collateralValue * BASIS_POINTS) / minCollateralRatio;
        
        // Adjust by credit score
        uint256 creditScore = userCreditScores[loan.borrower];
        if (creditScore >= 80) {
            maxByCollateral = (loan.collateralValue * BASIS_POINTS) / 11000;
        } else if (creditScore >= 70) {
            maxByCollateral = (loan.collateralValue * BASIS_POINTS) / 11500;
        }

        if (maxByCollateral <= loan.totalDebt) return 0;
        
        return maxByCollateral - loan.totalDebt;
    }

    /*//////////////////////////////////////////////////////////////
                        VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function getLoan(bytes32 loanId) external view override returns (Loan memory) {
        return loans[loanId];
    }

    function getCollateralPosition(bytes32 positionId)
        external
        view
        override
        returns (CollateralPosition memory)
    {
        return collateralPositions[positionId];
    }

    function getLoanCollateralPositions(bytes32 loanId)
        external
        view
        override
        returns (CollateralPosition[] memory)
    {
        bytes32[] storage positionIds = loanToCollateralPositions[loanId];
        CollateralPosition[] memory positions = new CollateralPosition[](positionIds.length);
        
        for (uint256 i = 0; i < positionIds.length; i++) {
            positions[i] = collateralPositions[positionIds[i]];
        }
        
        return positions;
    }

    function getBorrowerLoans(address borrower)
        external
        view
        override
        returns (bytes32[] memory)
    {
        return borrowerLoans[borrower];
    }

    function getTotalPoolValue() external view override returns (uint256) {
        return totalDeposits;
    }

    function getPoolUtilization() external view override returns (uint256) {
        if (totalDeposits == 0) return 0;
        return (totalBorrowed * BASIS_POINTS) / totalDeposits;
    }

    /*//////////////////////////////////////////////////////////////
                        ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function setCreditRiskOracle(address oracle) external override onlyOwner {
        require(oracle != address(0), "Invalid oracle");
        creditRiskOracle = oracle;
        emit OracleUpdated(oracle);
    }

    function setLiquidationThreshold(uint256 threshold) external override onlyOwner {
        require(threshold > 0 && threshold <= BASIS_POINTS, "Invalid threshold");
        liquidationThreshold = threshold;
    }

    function setMinCollateralRatio(uint256 ratio) external override onlyOwner {
        require(ratio > 0 && ratio <= 20000, "Invalid ratio");
        minCollateralRatio = ratio;
    }

    function setPoolParameters(
        uint256 _minLoanSize,
        uint256 _maxLoanSize,
        uint256 _maxLoanDuration,
        uint256 _baseInterestRate
    ) external override onlyOwner {
        require(_minLoanSize > 0 && _minLoanSize <= _maxLoanSize, "Invalid loan sizes");
        require(_maxLoanDuration > 0, "Invalid duration");
        require(_baseInterestRate > 0 && _baseInterestRate < 5000, "Invalid rate");

        minLoanSize = _minLoanSize;
        maxLoanSize = _maxLoanSize;
        maxLoanDuration = _maxLoanDuration;
        baseInterestRate = _baseInterestRate;

        emit PoolParametersUpdated(_minLoanSize, _maxLoanSize, _maxLoanDuration, _baseInterestRate);
    }

    /**
     * @notice Update a user's credit score (called from backend)
     */
    function updateCreditScore(address user, uint256 score) external onlyOwner {
        require(user != address(0), "Invalid user");
        require(score <= 100, "Score must be 0-100");
        userCreditScores[user] = score;
        emit CreditScoreUpdated(user, score);
    }

    /**
     * @notice Update stablecoin address
     */
    function setStablecoin(address _stablecoin) external onlyOwner {
        require(_stablecoin != address(0), "Invalid address");
        stablecoin = IERC20(_stablecoin);
        emit StablecoinUpdated(_stablecoin);
    }

    /**
     * @notice Update fraction token address
     */
    function setFractionToken(address _fractionToken) external onlyOwner {
        require(_fractionToken != address(0), "Invalid address");
        fractionToken = IERC1155(_fractionToken);
        emit FractionTokenUpdated(_fractionToken);
    }

    /**
     * @notice Update escrow contract address
     */
    function setEscrowContract(address _escrow) external onlyOwner {
        require(_escrow != address(0), "Invalid address");
        escrowContract = _escrow;
        emit EscrowContractUpdated(_escrow);
    }

    /**
     * @notice Emergency withdraw (admin only)
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    /**
     * @notice Withdraw accumulated interest to treasury
     */
    function withdrawInterest(address _treasury, uint256 _amount) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury");
        stablecoin.safeTransfer(_treasury, _amount);
    }

    /*//////////////////////////////////////////////////////////////
                        ERC2771 OVERRIDES
    //////////////////////////////////////////////////////////////*/

    function _msgSender()
        internal
        view
        override(ERC2771ContextUpgradeable, ContextUpgradeable)
        returns (address)
    {
        return ERC2771ContextUpgradeable._msgSender();
    }

    function _msgData()
        internal
        view
        override(ERC2771ContextUpgradeable, ContextUpgradeable)
        returns (bytes calldata)
    {
        return ERC2771ContextUpgradeable._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        override(ERC2771ContextUpgradeable, ContextUpgradeable)
        returns (uint256)
    {
        return ERC2771ContextUpgradeable._contextSuffixLength();
    }
}

