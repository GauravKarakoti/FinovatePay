// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract EscrowContract {
    // --- State Variables for Multi-Sig ---
    mapping(address => bool) public isManager;
    address[] public managers;
    uint public threshold;

    struct Proposal {
        address targetArbitrator;
        bool isAddition; // true = add, false = remove
        uint approvalCount;
        bool executed;
    }

    mapping(uint => Proposal) public proposals;
    mapping(uint => mapping(address => bool)) public hasApproved;
    uint public proposalCount;

    // --- Existing state for arbitrators ---
    mapping(address => bool) public isArbitrator;

    // --- Events ---
    event ArbitratorProposed(uint indexed proposalId, address indexed target, bool isAddition);
    event ProposalApproved(uint indexed proposalId, address indexed manager);
    event ProposalExecuted(uint indexed proposalId, address indexed target, bool isAddition);
    event ArbitratorAdded(address indexed arbitrator);
    event ArbitratorRemoved(address indexed arbitrator);

    // --- Modifiers ---
    modifier onlyManager() {
        require(isManager[msg.sender], "Not a manager");
        _;
    }

    modifier proposalExists(uint _proposalId) {
        require(_proposalId < proposalCount, "Proposal does not exist");
        _;
    }

    modifier notExecuted(uint _proposalId) {
        require(!proposals[_proposalId].executed, "Proposal already executed");
        _;
    }

    modifier notApproved(uint _proposalId) {
        require(!hasApproved[_proposalId][msg.sender], "Already approved");
        _;
    }

    // --- Constructor ---
    constructor(address[] memory _managers, uint _threshold) {
        require(_managers.length > 0, "Managers required");
        require(_threshold > 0 && _threshold <= _managers.length, "Invalid threshold");

        for (uint i = 0; i < _managers.length; i++) {
            address manager = _managers[i];
            require(manager != address(0), "Invalid manager address");
            require(!isManager[manager], "Duplicate manager");
            
            isManager[manager] = true;
            managers.push(manager);
        }
        threshold = _threshold;
    }

    // --- Multi-Sig Proposal Functions ---

    function proposeAddArbitrator(address _arbitrator) external onlyManager returns (uint) {
        require(!isArbitrator[_arbitrator], "Already an arbitrator");
        return _createProposal(_arbitrator, true);
    }

    function proposeRemoveArbitrator(address _arbitrator) external onlyManager returns (uint) {
        require(isArbitrator[_arbitrator], "Not an arbitrator");
        return _createProposal(_arbitrator, false);
    }

    function _createProposal(address _target, bool _isAddition) private returns (uint) {
        uint proposalId = proposalCount++;
        
        Proposal storage newProposal = proposals[proposalId];
        newProposal.targetArbitrator = _target;
        newProposal.isAddition = _isAddition;
        newProposal.approvalCount = 0;
        newProposal.executed = false;

        emit ArbitratorProposed(proposalId, _target, _isAddition);
        return proposalId;
    }

    // --- Approval and Execution ---

    function approveProposal(uint _proposalId) 
        external 
        onlyManager 
        proposalExists(_proposalId) 
        notExecuted(_proposalId) 
        notApproved(_proposalId) 
    {
        hasApproved[_proposalId][msg.sender] = true;
        proposals[_proposalId].approvalCount += 1;

        emit ProposalApproved(_proposalId, msg.sender);
    }

    function executeProposal(uint _proposalId) 
        external 
        onlyManager 
        proposalExists(_proposalId) 
        notExecuted(_proposalId) 
    {
        Proposal storage proposal = proposals[_proposalId];
        require(proposal.approvalCount >= threshold, "Threshold not met");

        proposal.executed = true;

        if (proposal.isAddition) {
            _addArbitrator(proposal.targetArbitrator);
        } else {
            _removeArbitrator(proposal.targetArbitrator);
        }

        emit ProposalExecuted(_proposalId, proposal.targetArbitrator, proposal.isAddition);
    }

    // --- Internal Execution Functions ---
    // Refactored to internal so they can ONLY be triggered by executed proposals

    function _addArbitrator(address _arbitrator) internal {
        isArbitrator[_arbitrator] = true;
        emit ArbitratorAdded(_arbitrator);
    }

    function _removeArbitrator(address _arbitrator) internal {
        isArbitrator[_arbitrator] = false;
        emit ArbitratorRemoved(_arbitrator);
    }
}