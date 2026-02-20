// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract GovernanceToken is ERC20Votes, ERC20Permit {
    uint256 public constant MAX_SUPPLY = 1_000_00 * 10 ** 18; //100k
    constructor()
        ERC20("Finovate", "FN")
        ERC20Permit("Finovate") // Needed for off-chain signatures
    {
        _mint(msg.sender, 100000);
    }

    // Required overrides

    /* There are two _update both in ERC20 and ERC20votes I need to override them to avoid confusion for solidity 
     so it is mandatory to override this.
    */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Votes) {
        if (from == address(0)) {
            require(totalSupply() + value <= MAX_SUPPLY, "MAX_SUPPLY exceeded");
        }
        super._update(from, to, value);
    }

    function nonces(
        address owner
    ) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}

//SomeOne knows a hot proposal is comming up
//so they buy a ton of token then dump it after
//Snapshot of token at a certain block
