// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract Box {
    uint256 private value;
    address public timelock;

    event ValueChanged(uint256 newValue);
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

    function store(uint256 newValue) external onlyTimelock {
        value = newValue;
        emit ValueChanged(newValue);
    }

    function retrieve() external view returns (uint256) {
        return value;
    }
}
