// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ArbitratorsRegistry {
    address public timelock;
    mapping(address => bool) public isArbitrator;
    uint256 public arbitratorCount;
    event ArbitratorAdded(address indexed arbitrator);
    event ArbitratorRemoved(address indexed arbitrator);
    event TimelockUpdated(address indexed newTimelock);

    modifier onlyTimelock() {
        require(msg.sender == timelock, "only Governance");
        _;
    }

    constructor(address _timelock) {
        require(_timelock != address(0), "Invalid timelock");
        timelock = _timelock;
    }

    function setTimelock(address _timelock) external onlyTimelock {
        require(_timelock != address(0), "Invalid timelock");
        timelock = _timelock;
        emit TimelockUpdated(_timelock);
    }

    function addArbitrator(address _arb) external onlyTimelock {
        require(_arb != address(0), "Invalid address");
        require(!isArbitrator[_arb], "Already arbitrator");
        isArbitrator[_arb] = true;
        arbitratorCount += 1;
        emit ArbitratorAdded(_arb);
    }

    function removeArbitrator(address _arb) external onlyTimelock {
        require(isArbitrator[_arb], "Not arbitrator");
        isArbitrator[_arb] = false;
        arbitratorCount -= 1;
        emit ArbitratorRemoved(_arb);
    }
}
