// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/governance/utils/IVotes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GovernanceManager
 * @dev Main governance contract for Finovate protocol
 * 
 * Features:
 * - Proposal creation and voting
 * - Timelock delay for execution
 * - Configurable voting parameters
 * - Integration with ERC20 voting tokens
 * - Automatic execution via Timelock
 */
contract GovernanceManager is
    Governor,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl,
    Ownable,
    ReentrancyGuard
{
    /// @notice Token used for voting
    IVotes public immutable governanceToken;
    
    /// @notice Timelock controller
    TimelockController public immutable timelock;
    
    /// @notice Minimum token balance to create proposals
    uint256 public proposalThresholdAmount = 100_000 * 10 ** 18; // 100k tokens
    
    /// @notice Maximum proposals that can be active
    uint256 public maxActiveProposals = 10;
    
    /// @notice Proposal creation fee (in native token)
    uint256 public proposalFee = 0;
    
    /// @notice Mapping of proposal executors
    mapping(address => bool) public authorizedExecutors;
    
    /// @notice Proposal category enum
    enum ProposalCategory {
        PARAMETER_UPDATE,
        FEE_UPDATE,
        TREASURY_UPDATE,
        EMERGENCY,
        UPGRADE,
        GENERAL
    }
    
    /// @notice Proposal metadata
    struct ProposalInfo {
        uint256 proposalId;
        ProposalCategory category;
        string title;
        string description;
        uint256 createdAt;
        address proposer;
    }
    
    /// @notice Mapping of proposal ID to metadata
    mapping(uint256 => ProposalInfo) public proposalInfo;
    
    /// @notice Events
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        ProposalCategory category,
        string title
    );
    event ProposalThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event MaxActiveProposalsUpdated(uint256 oldMax, uint256 newMax);
    event ProposalFeeUpdated(uint256 oldFee, uint256 newFee);
    event ExecutorAuthorized(address indexed executor, bool authorized);

    /**
     * @dev Constructor
     * @param _token Governance token (IVotes interface)
     * @param _timelock Timelock controller
     */
    constructor(
        IVotes _token,
        TimelockController _timelock
    )
        Governor("FinovateGovernance")
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(4) // 4% quorum
        GovernorTimelockControl(_timelock)
        Ownable(msg.sender)
    {
        governanceToken = _token;
        timelock = _timelock;
    }

    /**
     * @notice Override votingDelay - delay before voting starts
     * @return Voting delay in blocks (1 day = 7200 blocks approx)
     */
    function votingDelay() public pure override returns (uint256) {
        return 7200; // Approximately 1 day
    }

    /**
     * @notice Override votingPeriod - duration of voting
     * @return Voting period in blocks (1 week = 50400 blocks approx)
     */
    function votingPeriod() public pure override returns (uint256) {
        return 50400; // Approximately 1 week
    }

    /**
     * @notice Override proposalThreshold - tokens required to create proposals
     * @return Proposal threshold
     */
    function proposalThreshold() public view override returns (uint256) {
        return proposalThresholdAmount;
    }

    /**
     * @notice Get votes for an account at a specific block
     * @param voter Account to check votes for
     * @param blockNumber Block number to check at
     * @return Number of votes
     */
    function getVotes(
        address voter,
        uint256 blockNumber
    ) public view override returns (uint256) {
        return super.getVotes(voter, blockNumber);
    }

    /**
     * @notice Get proposal state
     * @param proposalId Proposal ID
     * @return Proposal state
     */
    function state(
        uint256 proposalId
    )
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    /**
     * @notice Check if proposal needs queuing
     * @param proposalId Proposal ID
     * @return Boolean
     */
    function proposalNeedsQueuing(
        uint256 proposalId
    ) public view override(Governor, GovernorTimelockControl) returns (bool) {
        return super.proposalNeedsQueuing(proposalId);
    }

    /**
     * @notice Override queue operations
     */
    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return
            super._queueOperations(
                proposalId,
                targets,
                values,
                calldatas,
                descriptionHash
            );
    }

    /**
     * @notice Override execute operations
     */
    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(
            proposalId,
            targets,
            values,
            calldatas,
            descriptionHash
        );
    }

    /**
     * @notice Override cancel function
     */
    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    /**
     * @notice Override executor
     */
    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }

    /**
     * @notice Create a new proposal
     * @param targets Target contracts
     * @param values ETH values
     * @param calldatas Call data
     * @param description Proposal description
     * @param category Proposal category
     * @param title Proposal title
     * @return Proposal ID
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        ProposalCategory category,
        string memory title
    ) public override returns (uint256) {
        // Check proposal fee
        require(msg.value >= proposalFee, "Insufficient proposal fee");
        
        // Check max active proposals
        uint256 activeCount = _countActiveProposals();
        require(activeCount < maxActiveProposals, "Too many active proposals");
        
        uint256 proposalId = super.propose(
            targets,
            values,
            calldatas,
            description
        );
        
        // Store proposal info
        proposalInfo[proposalId] = ProposalInfo({
            proposalId: proposalId,
            category: category,
            title: title,
            description: description,
            createdAt: block.timestamp,
            proposer: msg.sender
        });
        
        emit ProposalCreated(proposalId, msg.sender, category, title);
        
        // Refund excess fee
        if (msg.value > proposalFee) {
            payable(msg.sender).transfer(msg.value - proposalFee);
        }
        
        return proposalId;
    }

    /**
     * @notice Count active proposals
     * @return Number of active proposals
     */
    function _countActiveProposals() internal view returns (uint256) {
        uint256 count = 0;
        // This is a simplified version - in production you'd track this differently
        return count;
    }

    /**
     * @notice Set proposal threshold
     * @param _threshold New threshold
     */
    function setProposalThreshold(uint256 _threshold) external onlyOwner {
        uint256 oldThreshold = proposalThresholdAmount;
        proposalThresholdAmount = _threshold;
        emit ProposalThresholdUpdated(oldThreshold, _threshold);
    }

    /**
     * @notice Set max active proposals
     * @param _max New max
     */
    function setMaxActiveProposals(uint256 _max) external onlyOwner {
        require(_max > 0, "Max must be > 0");
        uint256 oldMax = maxActiveProposals;
        maxActiveProposals = _max;
        emit MaxActiveProposalsUpdated(oldMax, _max);
    }

    /**
     * @notice Set proposal fee
     * @param _fee New fee
     */
    function setProposalFee(uint256 _fee) external onlyOwner {
        uint256 oldFee = proposalFee;
        proposalFee = _fee;
        emit ProposalFeeUpdated(oldFee, _fee);
    }

    /**
     * @notice Authorize/unauthorize executors
     * @param executor Executor address
     * @param authorized Authorization status
     */
    function setExecutor(address executor, bool authorized) external onlyOwner {
        authorizedExecutors[executor] = authorized;
        emit ExecutorAuthorized(executor, authorized);
    }

    /**
     * @notice Execute proposal directly (if authorized)
     * @param targets Target contracts
     * @param values ETH values
     * @param calldatas Call data
     * @param descriptionHash Description hash
     */
    function execute(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public payable override returns (uint256) {
        require(
            authorizedExecutors[msg.sender] || msg.sender == owner(),
            "Not authorized"
        );
        return super.execute(targets, values, calldatas, descriptionHash);
    }

    /**
     * @notice Get proposal details
     * @param proposalId Proposal ID
     * @return Proposal info
     */
    function getProposalDetails(uint256 proposalId)
        external
        view
        returns (ProposalInfo memory)
    {
        return proposalInfo[proposalId];
    }

    /**
     * @notice Get voting power at current block
     * @param account Account to check
     * @return Voting power
     */
    function getVotingPower(address account) external view returns (uint256) {
        return governanceToken.getVotes(account);
    }

    /**
     * @notice Get voting power at a specific block
     * @param account Account to check
     * @param blockNumber Block number
     * @return Voting power
     */
    function getVotingPowerAt(
        address account,
        uint256 blockNumber
    ) external view returns (uint256) {
        return governanceToken.getPastVotes(account, blockNumber);
    }

    /**
     * @notice Update quorum fraction
     * @param _quorumFraction New quorum fraction (in basis points)
     */
    function updateQuorumFraction(uint256 _quorumFraction) external onlyOwner {
        require(_quorumFraction <= 10000, "Invalid quorum fraction");
        _setQuorumFraction(_quorumFraction);
    }

    /**
     * @notice Get timelock delay
     * @return Delay in seconds
     */
    function getTimelockDelay() external view returns (uint256) {
        return timelock.getMinDelay();
    }

    // Required override for solidity compiler
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(Governor, TimelockControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}

