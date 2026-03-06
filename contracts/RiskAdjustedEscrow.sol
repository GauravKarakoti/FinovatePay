// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title RiskAdjustedEscrow
 * @dev Escrow contract with dynamic terms based on AI-generated risk profiles
 * 
 * Features:
 * - Dynamic interest rates based on borrower risk score
 * - Risk-based collateral requirements
 * - Automatic rate adjustments based on payment history
 * - Penalty system for late payments proportional to risk level
 */
contract RiskAdjustedEscrow is ReentrancyGuard, Ownable {
    
    // Enums
    enum EscrowState { 
        Created, 
        Funded, 
        Active, 
        Completed, 
        Disputed, 
        Cancelled 
    }
    
    enum RiskLevel { 
        Excellent,    // Score 0-20
        Good,         // Score 21-35
        Moderate,     // Score 36-50
        High,         // Score 51-70
        VeryHigh      // Score 71-100
    }

    // Structs
    struct EscrowTerms {
        uint256 principalAmount;
        uint256 interestRate;        // Annual rate in basis points (100 = 1%)
        uint256 collateralRatio;      // Required collateral as percentage of principal
        uint256 duration;            // Loan duration in seconds
        uint256 riskScore;           // AI risk score at time of escrow creation
        RiskLevel riskLevel;        // Categorized risk level
    }
    
    struct PaymentSchedule {
        uint256 totalDue;
        uint256 paid;
        uint256 nextDueDate;
        uint256 latePayments;
    }

    // State Variables
    mapping(bytes32 => EscrowState) public escrowStates;
    mapping(bytes32 => EscrowTerms) public escrowTerms;
    mapping(bytes32 => PaymentSchedule) public paymentSchedules;
    mapping(bytes32 => address) public escrowBeneficiaries;
    mapping(bytes32 => address) public escrowLenders;
    mapping(bytes32 => uint256) public escrowCreatedAt;
    
    // Risk-based configuration
    mapping(RiskLevel => uint256) public riskBasedInterestRates;    // Basis points
    mapping(RiskLevel => uint256) public riskBasedCollateralRatios;  // Percentage
    mapping(RiskLevel => uint256) public riskBasedLatePenalties;    // Basis points per day
    
    // Events
    event EscrowCreated(
        bytes32 indexed escrowId,
        address indexed borrower,
        address indexed lender,
        uint256 principal,
        uint256 interestRate,
        uint256 riskScore
    );
    
    event EscrowFunded(bytes32 indexed escrowId, uint256 amount);
    event EscrowActivated(bytes32 indexed escrowId);
    event PaymentMade(
        bytes32 indexed escrowId,
        uint256 amount,
        uint256 remaining
    );
    event PaymentLate(
        bytes32 indexed escrowId,
        uint256 penalty,
        uint256 daysLate
    );
    event EscrowCompleted(bytes32 indexed escrowId);
    event EscrowCancelled(bytes32 indexed escrowId);
    event RateAdjusted(
        bytes32 indexed escrowId,
        uint256 oldRate,
        uint256 newRate,
        string reason
    );

    // Modifiers
    modifier onlyInState(bytes32 escrowId, EscrowState state) {
        require(escrowStates[escrowId] == state, "Invalid escrow state");
        _;
    }

    modifier onlyBorrower(bytes32 escrowId) {
        require(msg.sender == escrowBeneficiaries[escrowId], "Only borrower");
        _;
    }

    modifier onlyLender(bytes32 escrowId) {
        require(msg.sender == escrowLenders[escrowId], "Only lender");
        _;
    }

    // Constructor
    constructor() {
        // Initialize risk-based configurations
        // Excellent risk (0-20): Low rates, low collateral
        riskBasedInterestRates[RiskLevel.Excellent] = 300;    // 3% APR
        riskBasedCollateralRatios[RiskLevel.Excellent] = 0;    // 0% collateral
        riskBasedLatePenalties[RiskLevel.Excellent] = 10;      // 0.1% per day
        
        // Good risk (21-35)
        riskBasedInterestRates[RiskLevel.Good] = 500;         // 5% APR
        riskBasedCollateralRatios[RiskLevel.Good] = 10;        // 10% collateral
        riskBasedLatePenalties[RiskLevel.Good] = 15;           // 0.15% per day
        
        // Moderate risk (36-50)
        riskBasedInterestRates[RiskLevel.Moderate] = 800;      // 8% APR
        riskBasedCollateralRatios[RiskLevel.Moderate] = 25;      // 25% collateral
        riskBasedLatePenalties[RiskLevel.Moderate] = 25;       // 0.25% per day
        
        // High risk (51-70)
        riskBasedInterestRates[RiskLevel.High] = 1200;         // 12% APR
        riskBasedCollateralRatios[RiskLevel.High] = 50;         // 50% collateral
        riskBasedLatePenalties[RiskLevel.High] = 50;           // 0.5% per day
        
        // Very High risk (71-100)
        riskBasedInterestRates[RiskLevel.VeryHigh] = 2000;     // 20% APR
        riskBasedCollateralRatios[RiskLevel.VeryHigh] = 100;    // 100% collateral
        riskBasedLatePenalties[RiskLevel.VeryHigh] = 100;      // 1% per day
    }

    /**
     * @dev Create a new risk-adjusted escrow
     * @param _escrowId Unique escrow identifier
     * @param _borrower Address receiving funds
     * @param _lender Address providing funds
     * @param _principalAmount Amount being borrowed
     * @param _duration Loan duration in seconds
     * @param _riskScore AI-generated risk score (0-100)
     */
    function createEscrow(
        bytes32 _escrowId,
        address _borrower,
        address _lender,
        uint256 _principalAmount,
        uint256 _duration,
        uint256 _riskScore
    ) external onlyOwner {
        require(escrowStates[_escrowId] == EscrowState.Created, "Escrow exists");
        require(_borrower != address(0), "Invalid borrower");
        require(_lender != address(0), "Invalid lender");
        require(_principalAmount > 0, "Invalid amount");
        require(_riskScore <= 100, "Invalid risk score");

        // Determine risk level from score
        RiskLevel riskLevel = _calculateRiskLevel(_riskScore);
        
        // Get risk-based terms
        uint256 interestRate = riskBasedInterestRates[riskLevel];
        uint256 collateralRatio = riskBasedCollateralRatios[riskLevel];
        
        // Calculate total repayment with interest
        uint256 interest = (_principalAmount * interestRate * _duration) / 
            (365 days * 10000);
        uint256 totalDue = _principalAmount + interest;
        
        // Set escrow terms
        escrowTerms[_escrowId] = EscrowTerms({
            principalAmount: _principalAmount,
            interestRate: interestRate,
            collateralRatio: collateralRatio,
            duration: _duration,
            riskScore: _riskScore,
            riskLevel: riskLevel
        });
        
        // Set payment schedule
        paymentSchedules[_escrowId] = PaymentSchedule({
            totalDue: totalDue,
            paid: 0,
            nextDueDate: block.timestamp + _duration,
            latePayments: 0
        });
        
        escrowBeneficiaries[_escrowId] = _borrower;
        escrowLenders[_escrowId] = _lender;
        escrowCreatedAt[_escrowId] = block.timestamp;
        escrowStates[_escrowId] = EscrowState.Created;
        
        emit EscrowCreated(
            _escrowId,
            _borrower,
            _lender,
            _principalAmount,
            interestRate,
            _riskScore
        );
    }

    /**
     * @dev Fund the escrow with collateral from borrower and principal from lender
     */
    function fundEscrow(bytes32 _escrowId)
        external
        payable
        onlyInState, EscrowState(_escrowId.Created)
        nonReentrant
    {
        EscrowTerms memory terms = escrowTerms[_escrowId];
        
        // Require collateral from borrower
        uint256 requiredCollateral = (terms.principalAmount * terms.collateralRatio) / 100;
        require(msg.value >= requiredCollateral, "Insufficient collateral");
        
        // Excess collateral returned to borrower
        if (msg.value > requiredCollateral) {
            payable(escrowBeneficiaries[_escrowId]).transfer(msg.value - requiredCollateral);
        }
        
        // Note: In production, lender would separately fund the principal
        // This is simplified for demonstration
        
        escrowStates[_escrowId] = EscrowState.Funded;
        
        emit EscrowFunded(_escrowId, msg.value);
    }

    /**
     * @dev Activate the escrow after both parties have funded
     */
    function activateEscrow(bytes32 _escrowId)
        external
        onlyInState(_escrowId, EscrowState.Funded)
        onlyLender(_escrowId)
    {
        // Transfer principal to borrower
        payable(escrowBeneficiaries[_escrowId]).transfer(escrowTerms[_escrowId].principalAmount);
        
        escrowStates[_escrowId] = EscrowState.Active;
        
        emit EscrowActivated(_escrowId);
    }

    /**
     * @dev Make a payment towards the escrow
     */
    function makePayment(bytes32 _escrowId)
        external
        payable
        onlyInState(_escrowId, EscrowState.Active)
        onlyBorrower(_escrowId)
        nonReentrant
    {
        PaymentSchedule storage schedule = paymentSchedules[_escrowId];
        EscrowTerms memory terms = escrowTerms[_escrowId];
        
        // Check if payment is late
        if (block.timestamp > schedule.nextDueDate) {
            uint256 daysLate = (block.timestamp - schedule.nextDueDate) / 1 days;
            uint256 latePenalty = (msg.value * riskBasedLatePenalties[terms.riskLevel] * daysLate) / 10000;
            
            // Apply penalty to lender
            payable(escrowLenders[_escrowId]).transfer(latePenalty);
            schedule.latePayments++;
            
            emit PaymentLate(_escrowId, latePenalty, daysLate);
            
            // Adjust interest rate for future payments due to late payment
            uint256 newRate = terms.interestRate + (terms.interestRate * schedule.latePayments / 10);
            escrowTerms[_escrowId].interestRate = newRate;
            
            emit RateAdjusted(_escrowId, terms.interestRate, newRate, "Late payment penalty");
        }
        
        // Process payment
        schedule.paid += msg.value;
        
        // Calculate remaining
        uint256 remaining = schedule.totalDue - schedule.paid;
        
        // Transfer payment to lender
        payable(escrowLenders[_escrowId]).transfer(msg.value);
        
        emit PaymentMade(_escrowId, msg.value, remaining);
        
        // Check if fully paid
        if (schedule.paid >= schedule.totalDue) {
            _completeEscrow(_escrowId);
        }
    }

    /**
     * @dev Complete the escrow and return collateral
     */
    function _completeEscrow(bytes32 _escrowId) internal {
        EscrowTerms memory terms = escrowTerms[_escrowId];
        
        // Return collateral to borrower
        uint256 collateral = (terms.principalAmount * terms.collateralRatio) / 100;
        payable(escrowBeneficiaries[_escrowId]).transfer(collateral);
        
        escrowStates[_escrowId] = EscrowState.Completed;
        
        emit EscrowCompleted(_escrowId);
    }

    /**
     * @dev Cancel escrow and return funds
     */
    function cancelEscrow(bytes32 _escrowId)
        external
        onlyInState(_escrowId, EscrowState.Created)
        onlyOwner
    {
        escrowStates[_escrowId] = EscrowState.Cancelled;
        
        emit EscrowCancelled(_escrowId);
    }

    /**
     * @dev Update risk configuration for a risk level
     */
    function updateRiskConfig(
        RiskLevel _level,
        uint256 _interestRate,
        uint256 _collateralRatio,
        uint256 _latePenalty
    ) external onlyOwner {
        require(_interestRate <= 10000, "Rate too high");
        require(_collateralRatio <= 200, "Collateral too high");
        
        riskBasedInterestRates[_level] = _interestRate;
        riskBasedCollateralRatios[_level] = _collateralRatio;
        riskBasedLatePenalties[_level] = _latePenalty;
    }

    /**
     * @dev Get current escrow status
     */
    function getEscrowStatus(bytes32 _escrowId) external view returns (
        EscrowState state,
        uint256 principal,
        uint256 paid,
        uint256 remaining,
        uint256 riskScore,
        RiskLevel riskLevel
    ) {
        state = escrowStates[_escrowId];
        EscrowTerms memory terms = escrowTerms[_escrowId];
        PaymentSchedule memory schedule = paymentSchedules[_escrowId];
        
        principal = terms.principalAmount;
        paid = schedule.paid;
        remaining = schedule.totalDue - schedule.paid;
        riskScore = terms.riskScore;
        riskLevel = terms.riskLevel;
    }

    /**
     * @dev Calculate risk level from score
     */
    function _calculateRiskLevel(uint256 _score) internal pure returns (RiskLevel) {
        if (_score <= 20) return RiskLevel.Excellent;
        if (_score <= 35) return RiskLevel.Good;
        if (_score <= 50) return RiskLevel.Moderate;
        if (_score <= 70) return RiskLevel.High;
        return RiskLevel.VeryHigh;
    }

    // Emergency functions
    receive() external payable {}
}

