// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IComplianceRegistry
 * @dev Interface for future Polygon CDK compliance precompile / runtime module.
 * This allows ComplianceManager to delegate compliance checks to chain-level logic.
 */
interface IComplianceRegistry {
    function isFrozen(address user) external view returns (bool);
    function isKYCVerified(address user) external view returns (bool);
    function hasIdentity(address user) external view returns (bool);
}
