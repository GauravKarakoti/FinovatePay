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
    
    event ArbitratorAdded(address indexed arbitrator);
    event ArbitratorRemoved(address indexed arbitrator);
    
    constructor() Ownable(msg.sender) {
        // Add deployer as first arbitrator
        _addArbitrator(msg.sender);
    }
    
    /**
     * @dev Add a new arbitrator to the registry
     * @param _arbitrator Address of the arbitrator to add
     */
    function addArbitrator(address _arbitrator) external onlyOwner {
        require(_arbitrator != address(0), "Invalid arbitrator address");
        require(!isArbitrator[_arbitrator], "Already an arbitrator");
        
        _addArbitrator(_arbitrator);
    }
    
    /**
     * @dev Remove an arbitrator from the registry
     * @param _arbitrator Address of the arbitrator to remove
     */
    function removeArbitrator(address _arbitrator) external onlyOwner {
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
