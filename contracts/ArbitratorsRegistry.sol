// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ArbitratorsRegistry
 * @dev Manages the list of authorized arbitrators for dispute resolution
 * @notice This contract maintains a registry of arbitrators who can vote on disputes
 */
contract ArbitratorsRegistry is Ownable {
    mapping(address => bool) public isArbitrator;
    address[] public arbitratorList;
    uint256 public arbitratorCount;
    
    // Individual operation events
    event ArbitratorAdded(address indexed arbitrator);
    event ArbitratorRemoved(address indexed arbitrator);
    
    // Batch operation events
    event ArbitratorsAddedBatch(address[] indexed arbitrators, uint256 count, uint256 totalArbitrators);
    event ArbitratorsRemovedBatch(address[] indexed arbitrators, uint256 count, uint256 totalArbitrators);
    
    // Governance events
    event ArbitratorCountUpdated(uint256 oldCount, uint256 newCount);
    event RegistryStateChanged(uint256 totalArbitrators, string action);
    
    constructor() Ownable(msg.sender) {
        // Add deployer as first arbitrator
        _addArbitrator(msg.sender);
    }
    
    /**
     * @dev Add multiple arbitrators to the registry
     * @param _arbitrators Array of arbitrator addresses to add
     * @notice Emits ArbitratorAdded for each addition and ArbitratorsAddedBatch for the batch operation
     */
    function addArbitrators(address[] calldata _arbitrators) external onlyOwner {
        require(_arbitrators.length > 0, "No arbitrators provided");
        
        uint256 addedCount = 0;
        
        for (uint256 i = 0; i < _arbitrators.length; i++) {
            address arbitrator = _arbitrators[i];
            require(arbitrator != address(0), "Invalid arbitrator address");
            require(!isArbitrator[arbitrator], "Already an arbitrator");
            _addArbitrator(arbitrator);
            addedCount++;
        }
        
        // Ensure total count is odd to prevent voting deadlocks
        require(arbitratorCount % 2 != 0, "Arbitrator count must be odd");
        
        // Emit batch event
        emit ArbitratorsAddedBatch(_arbitrators, addedCount, arbitratorCount);
        emit RegistryStateChanged(arbitratorCount, "BATCH_ADD");
    }

    /**
     * @dev Add a new arbitrator to the registry
     * @param _arbitrator Address of the arbitrator to add
     * @notice Emits ArbitratorAdded event on successful addition
     */
    function addArbitrator(address _arbitrator) external onlyOwner {
        require(_arbitrator != address(0), "Invalid arbitrator address");
        require(!isArbitrator[_arbitrator], "Already an arbitrator");
        
        uint256 oldCount = arbitratorCount;
        _addArbitrator(_arbitrator);
        
        // Fix for deadlock issue: Ensure odd number of arbitrators
        require(arbitratorCount % 2 != 0, "Arbitrator count must be odd");
        
        // Emit governance event
        emit ArbitratorCountUpdated(oldCount, arbitratorCount);
        emit RegistryStateChanged(arbitratorCount, "ADD");
    }
    
    /**
     * @dev Remove multiple arbitrators from the registry
     * @param _arbitrators Array of arbitrator addresses to remove
     * @notice Emits ArbitratorRemoved for each removal and ArbitratorsRemovedBatch for the batch operation
     */
    function removeArbitrators(address[] calldata _arbitrators) external onlyOwner {
        require(_arbitrators.length > 0, "No arbitrators provided");
        
        uint256 removedCount = 0;
        
        for (uint256 i = 0; i < _arbitrators.length; i++) {
            _removeArbitrator(_arbitrators[i]);
            removedCount++;
        }
        
        // Ensure total count is odd to prevent voting deadlocks
        require(arbitratorCount % 2 != 0, "Arbitrator count must be odd");
        
        // Emit batch event
        emit ArbitratorsRemovedBatch(_arbitrators, removedCount, arbitratorCount);
        emit RegistryStateChanged(arbitratorCount, "BATCH_REMOVE");
    }

    /**
     * @dev Remove an arbitrator from the registry
     * @param _arbitrator Address of the arbitrator to remove
     * @notice Emits ArbitratorRemoved event on successful removal
     */
    function removeArbitrator(address _arbitrator) external onlyOwner {
        uint256 oldCount = arbitratorCount;
        _removeArbitrator(_arbitrator);
        
        // Fix for deadlock issue: Ensure odd number of arbitrators
        require(arbitratorCount % 2 != 0, "Arbitrator count must be odd");
        
        // Emit governance event
        emit ArbitratorCountUpdated(oldCount, arbitratorCount);
        emit RegistryStateChanged(arbitratorCount, "REMOVE");
    }
    
    /**
     * @dev Internal function to remove arbitrator
     */
    function _removeArbitrator(address _arbitrator) private {
        require(isArbitrator[_arbitrator], "Not an arbitrator");
        require(arbitratorCount > 1, "Cannot remove last arbitrator");
        
        isArbitrator[_arbitrator] = false;
        arbitratorCount--;
        
        // Remove from list
        for (uint256 i = 0; i < arbitratorList.length; i++) {
            if (arbitratorList[i] == _arbitrator) {
                arbitratorList[i] = arbitratorList[arbitratorList.length - 1];
                arbitratorList.pop();
                break;
            }
        }
        
        emit ArbitratorRemoved(_arbitrator);
    }
    
    /**
     * @dev Get all arbitrators
     * @return Array of arbitrator addresses
     */
    function getArbitrators() external view returns (address[] memory) {
        return arbitratorList;
    }
    
    /**
     * @dev Internal function to add arbitrator
     */
    function _addArbitrator(address _arbitrator) private {
        isArbitrator[_arbitrator] = true;
        arbitratorList.push(_arbitrator);
        arbitratorCount++;
        
        emit ArbitratorAdded(_arbitrator);
    }
}
