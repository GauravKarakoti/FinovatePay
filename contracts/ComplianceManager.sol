// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract ComplianceManager is Ownable {
    mapping(address => bool) private frozenAccounts;
    mapping(address => bool) private kycVerified;
    
    event AccountFrozen(address indexed account);
    event AccountUnfrozen(address indexed account);
    event KYCVerified(address indexed account);
    event KYCRevoked(address indexed account);

    /**
     * @dev Sets the contract deployer as the initial owner.
     */
    constructor() Ownable(msg.sender) {
        // The Ownable constructor is called with the address of the deployer.
    }
    
    function freezeAccount(address _account) external onlyOwner {
        frozenAccounts[_account] = true;
        emit AccountFrozen(_account);
    }
    
    function unfreezeAccount(address _account) external onlyOwner {
        frozenAccounts[_account] = false;
        emit AccountUnfrozen(_account);
    }
    
    function verifyKYC(address _account) external onlyOwner {
        kycVerified[_account] = true;
        emit KYCVerified(_account);
    }
    
    function revokeKYC(address _account) external onlyOwner {
        kycVerified[_account] = false;
        emit KYCRevoked(_account);
    }
    
    function isFrozen(address _account) external view returns (bool) {
        return frozenAccounts[_account];
    }
    
    function isKYCVerified(address _account) external view returns (bool) {
        return kycVerified[_account];
    }
    
    modifier onlyCompliant(address _account) {
        require(!frozenAccounts[_account], "Account is frozen");
        require(kycVerified[_account], "KYC not verified");
        _;
    }
}