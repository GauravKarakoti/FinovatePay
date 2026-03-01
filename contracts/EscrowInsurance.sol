// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title EscrowInsurance
 * @dev Optional insurance coverage for escrow transactions protecting against 
 * counterparty default or smart contract failure.
 */
contract EscrowInsurance is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/
    
    enum InsuranceStatus {
        Active,
        Claimed,
        Expired,
        Cancelled
    }

    enum ClaimReason {
        CounterpartyDefault,
        SmartContractFailure,
        ForceMajeure
    }

    struct InsurancePolicy {
        bytes32 policyId;
        bytes32 invoiceId;
        address insuredParty;
        uint256 coverageAmount;
        uint256 premiumPaid;
        uint256 duration;          // Duration in seconds
        uint256 startTime;
        uint256 endTime;
        InsuranceStatus status;
        bool claimApproved;
        uint256 claimAmount;
        ClaimReason claimReason;
        string claimEvidence;
    }

    /*//////////////////////////////////////////////////////////////
                            STATE VARIABLES
    //////////////////////////////////////////////////////////////*/
    
    // Premium configuration (in basis points)
    uint256 public basePremiumBps = 200; // 2% base premium
    uint256 public durationMultiplierBps = 50; // Additional 0.5% per month
    
    // Coverage limits
    uint256 public maxCoverageAmount = 1000000 ether;
    uint256 public minCoverageAmount = 100 ether;
    
    // Maximum duration (in seconds) - 2 years
    uint256 public constant MAX_DURATION = 730 days;
    
    // Treasury address for collecting premiums
    address public treasury;
    
    // Mappings
    mapping(bytes32 => InsurancePolicy) public policies;
    mapping(bytes32 => bool) public policyIds;
    mapping(address => bytes32[]) public insuredPolicies;
    
    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    
    event PolicyCreated(
        bytes32 indexed policyId,
        bytes32 indexed invoiceId,
        address indexed insuredParty,
        uint256 coverageAmount,
        uint256 premiumPaid,
        uint256 duration
    );
    
    event PolicyClaimed(
        bytes32 indexed policyId,
        bytes32 indexed invoiceId,
        ClaimReason reason,
        uint256 claimAmount
    );
    
    event ClaimApproved(
        bytes32 indexed policyId,
        uint256 approvedAmount
    );
    
    event PolicyCancelled(
        bytes32 indexed policyId
    );
    
    event PolicyExpired(
        bytes32 indexed policyId
    );
    
    event PremiumConfigUpdated(
        uint256 oldBasePremium,
        uint256 newBasePremium,
        uint256 oldDurationMultiplier,
        uint256 newDurationMultiplier
    );
    
    event CoverageLimitsUpdated(
        uint256 oldMaxCoverage,
        uint256 newMaxCoverage,
        uint256 oldMinCoverage,
        uint256 newMinCoverage
    );
    
    event TreasuryUpdated(
        address indexed oldTreasury,
        address indexed newTreasury
    );

    /*//////////////////////////////////////////////////////////////
                            MODIFIERS
    //////////////////////////////////////////////////////////////*/
    
    modifier onlyValidPolicy(bytes32 _policyId) {
        require(policyIds[_policyId], "Policy does not exist");
        _;
    }
    
    modifier onlyActivePolicy(bytes32 _policyId) {
        require(policies[_policyId].status == InsuranceStatus.Active, "Policy not active");
        require(block.timestamp <= policies[_policyId].endTime, "Policy expired");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
    
    constructor(address _treasury) Ownable(msg.sender) {
        require(_treasury != address(0), "Treasury cannot be zero address");
        treasury = _treasury;
    }

    /*//////////////////////////////////////////////////////////////
                        PREMIUM CALCULATION
    //////////////////////////////////////////////////////////////*/
    
    /**
     * @notice Calculate the premium for an insurance policy
     * @param _coverageAmount The amount to be insured
     * @param _duration The duration of coverage in seconds
     * @return premium The calculated premium
     */
    function calculatePremium(uint256 _coverageAmount, uint256 _duration) 
        public 
        view 
        returns (uint256 premium) 
    {
        require(_coverageAmount >= minCoverageAmount, "Coverage below minimum");
        require(_coverageAmount <= maxCoverageAmount, "Coverage exceeds maximum");
        require(_duration > 0 && _duration <= MAX_DURATION, "Invalid duration");
        
        // Base premium calculation (bps of coverage amount)
        uint256 basePremium = (_coverageAmount * basePremiumBps) / 10000;
        
        // Duration multiplier (additional bps per month)
        uint256 months = _duration / 30 days;
        uint256 durationPremium = (_coverageAmount * durationMultiplierBps * months) / 10000;
        
        premium = basePremium + durationPremium;
        
        // Ensure minimum premium
        if (premium < 1 ether) {
            premium = 1 ether;
        }
    }

    /*//////////////////////////////////////////////////////////////
                        INSURANCE OPERATIONS
    //////////////////////////////////////////////////////////////*/
    
    /**
     * @notice Purchase insurance for an escrow
     * @param _invoiceId The invoice/escrow ID to insure
     * @param _coverageAmount The amount of coverage
     * @param _duration The duration of coverage
     * @param _paymentToken The token to pay premium in
     * @return policyId The created policy ID
     */
    function insureEscrow(
        bytes32 _invoiceId,
        uint256 _coverageAmount,
        uint256 _duration,
        address _paymentToken
    ) external nonReentrant whenNotPaused returns (bytes32 policyId) {
        require(_invoiceId != bytes32(0), "Invalid invoice ID");
        require(_coverageAmount >= minCoverageAmount, "Coverage below minimum");
        require(_coverageAmount <= maxCoverageAmount, "Coverage exceeds maximum");
        require(_duration > 0 && _duration <= MAX_DURATION, "Invalid duration");
        
        // Calculate premium
        uint256 premium = calculatePremium(_coverageAmount, _duration);
        
        // Generate policy ID
        policyId = keccak256(abi.encodePacked(
            _invoiceId,
            msg.sender,
            _coverageAmount,
            block.timestamp
        ));
        
        require(!policyIds[policyId], "Policy already exists");
        
        // Collect premium
        if (_paymentToken == address(0)) {
            require(msg.value >= premium, "Insufficient ETH sent");
            // Refund excess
            if (msg.value > premium) {
                payable(msg.sender).transfer(msg.value - premium);
            }
        } else {
            IERC20(_paymentToken).safeTransferFrom(msg.sender, treasury, premium);
        }
        
        // Create policy
        uint256 startTime = block.timestamp;
        policies[policyId] = InsurancePolicy({
            policyId: policyId,
            invoiceId: _invoiceId,
            insuredParty: msg.sender,
            coverageAmount: _coverageAmount,
            premiumPaid: premium,
            duration: _duration,
            startTime: startTime,
            endTime: startTime + _duration,
            status: InsuranceStatus.Active,
            claimApproved: false,
            claimAmount: 0,
            claimReason: ClaimReason.CounterpartyDefault,
            claimEvidence: ""
        });
        
        policyIds[policyId] = true;
        insuredPolicies[msg.sender].push(policyId);
        
        emit PolicyCreated(
            policyId,
            _invoiceId,
            msg.sender,
            _coverageAmount,
            premium,
            _duration
        );
    }
    
    /**
     * @notice File a claim on an insurance policy
     * @param _policyId The policy ID
     * @param _reason The reason for the claim
     * @param _evidence Evidence/documentation for the claim
     */
    function claimInsurance(
        bytes32 _policyId,
        ClaimReason _reason,
        string calldata _evidence
    ) 
        external 
        nonReentrant 
        onlyValidPolicy(_policyId) 
        onlyActivePolicy(_policyId) 
    {
        InsurancePolicy storage policy = policies[_policyId];
        
        require(policy.insuredParty == msg.sender, "Not the insured party");
        require(!policy.claimApproved, "Claim already processed");
        
        // Update policy with claim details
        policy.status = InsuranceStatus.Claimed;
        policy.claimReason = _reason;
        policy.claimEvidence = _evidence;
        
        emit PolicyClaimed(_policyId, policy.invoiceId, _reason, policy.coverageAmount);
    }
    
    /**
     * @notice Approve a claim and payout
     * @param _policyId The policy ID
     * @param _claimAmount The amount to payout (can be less than coverage)
     * @param _payoutToken The token to payout in
     */
    function approveClaim(
        bytes32 _policyId,
        uint256 _claimAmount,
        address _payoutToken
    ) 
        external 
        onlyOwner 
        nonReentrant 
        onlyValidPolicy(_policyId) 
    {
        InsurancePolicy storage policy = policies[_policyId];
        
        require(policy.status == InsuranceStatus.Claimed, "Policy not in claimed status");
        require(!policy.claimApproved, "Claim already approved");
        require(_claimAmount <= policy.coverageAmount, "Claim exceeds coverage");
        
        policy.claimApproved = true;
        policy.claimAmount = _claimAmount;
        policy.status = InsuranceStatus.Claimed;
        
        // Payout to insured party
        if (_payoutToken == address(0)) {
            payable(policy.insuredParty).transfer(_claimAmount);
        } else {
            IERC20(_payoutToken).safeTransfer(policy.insuredParty, _claimAmount);
        }
        
        emit ClaimApproved(_policyId, _claimAmount);
    }
    
    /**
     * @notice Cancel an insurance policy (only by insured party, before claim)
     * @param _policyId The policy ID
     */
    function cancelPolicy(bytes32 _policyId) 
        external 
        nonReentrant 
        onlyValidPolicy(_policyId) 
    {
        InsurancePolicy storage policy = policies[_policyId];
        
        require(policy.insuredParty == msg.sender, "Not the insured party");
        require(policy.status == InsuranceStatus.Active, "Policy not active");
        
        policy.status = InsuranceStatus.Cancelled;
        
        emit PolicyCancelled(_policyId);
    }
    
    /**
     * @notice Check and expire policies that have passed their end time
     * @param _policyId The policy ID
     */
    function checkAndExpire(bytes32 _policyId) 
        external 
        onlyValidPolicy(_policyId) 
    {
        InsurancePolicy storage policy = policies[_policyId];
        
        if (policy.status == InsuranceStatus.Active && block.timestamp > policy.endTime) {
            policy.status = InsuranceStatus.Expired;
            emit PolicyExpired(_policyId);
        }
    }

    /*//////////////////////////////////////////////////////////////
                        ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    
    /**
     * @notice Set premium configuration
     * @param _basePremiumBps New base premium in bps
     * @param _durationMultiplierBps New duration multiplier in bps
     */
    function setPremiumConfig(uint256 _basePremiumBps, uint256 _durationMultiplierBps) 
        external 
        onlyOwner 
    {
        require(_basePremiumBps <= 1000, "Base premium too high"); // Max 10%
        require(_durationMultiplierBps <= 200, "Duration multiplier too high"); // Max 2% per month
        
        uint256 oldBase = basePremiumBps;
        uint256 oldDuration = durationMultiplierBps;
        
        basePremiumBps = _basePremiumBps;
        durationMultiplierBps = _durationMultiplierBps;
        
        emit PremiumConfigUpdated(oldBase, _basePremiumBps, oldDuration, _durationMultiplierBps);
    }
    
    /**
     * @notice Set coverage limits
     * @param _maxCoverageAmount New maximum coverage
     * @param _minCoverageAmount New minimum coverage
     */
    function setCoverageLimits(uint256 _maxCoverageAmount, uint256 _minCoverageAmount) 
        external 
        onlyOwner 
    {
        require(_minCoverageAmount > 0, "Min coverage must be > require(_maxCoverageAmount > 0");
        _minCoverageAmount, "Max must exceed min");
        
        uint256 oldMax = maxCoverageAmount;
        uint256 oldMin = minCoverageAmount;
        
        maxCoverageAmount = _maxCoverageAmount;
        minCoverageAmount = _minCoverageAmount;
        
        emit CoverageLimitsUpdated(oldMax, _maxCoverageAmount, oldMin, _minCoverageAmount);
    }
    
    /**
     * @notice Set treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Treasury cannot be zero");
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    /*//////////////////////////////////////////////////////////////
                        VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    
    /**
     * @notice Get policy details
     * @param _policyId The policy ID
     * @return Policy details
     */
    function getPolicy(bytes32 _policyId) 
        external 
        view 
        onlyValidPolicy(_policyId) 
        returns (InsurancePolicy memory) 
    {
        return policies[_policyId];
    }
    
    /**
     * @notice Get policies for an address
     * @param _insuredParty The insured party address
     * @return Array of policy IDs
     */
    function getPoliciesByAddress(address _insuredParty) 
        external 
        view 
        returns (bytes32[] memory) 
    {
        return insuredPolicies[_insuredParty];
    }
    
    /**
     * @notice Check if a policy exists
     * @param _policyId The policy ID
     * @return Whether the policy exists
     */
    function hasPolicy(bytes32 _policyId) external view returns (bool) {
        return policyIds[_policyId];
    }

    /*//////////////////////////////////////////////////////////////
                        RECEIVE FUNCTION
    //////////////////////////////////////////////////////////////*/
    
    receive() external payable {
        // Accept ETH for payouts
    }
}
