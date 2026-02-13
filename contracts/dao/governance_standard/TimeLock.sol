// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title TimeLock
 * @dev This contract holds proposals for a minimum delay before execution.
 *      It is used together with Governor contracts to enforce delayed execution.
 *
 * Flow:
 *  - Proposal Created in Governor
 *  - Voting Period
 *  - Proposal Succeeded → Queued in Timelock
 *  - Min Delay Countdown
 *  - Executed (only after delay)
 *
 *  Timelock ensures:
 *     • Users who disagree can exit before changes apply.
 *     • No instant malicious governance action.
 */
contract TimeLock is TimelockController {
    /**
     * @param minDelay     Minimum delay (in seconds) before a proposal can be executed.
     * @param proposers    Addresses allowed to propose actions to the timelock.
     * @param executors    Addresses allowed to execute queued proposals.
     * @param admin        Optional admin (can be zero address).
     *                     Admin can grant/renounce roles.
     *                     Once deployed, admin is usually renounced for decentralization.
     */
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    )
        TimelockController(
            minDelay, // minimum delay
            proposers, // addresses allowed to propose
            executors, // addresses allowed to execute
            admin // admin (can renounce)
        )
    {
        
    }
}
