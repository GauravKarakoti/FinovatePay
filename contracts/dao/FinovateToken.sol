// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FinovateToken
 * @dev ERC20 governance token for Finovate protocol
 * 
 * Features:
 * - ERC20Votes for governance voting power
 * - ERC20Permit for gasless approvals
 * - Configurable max supply
 * - Token minting for rewards and incentives
 * - Transfer restrictions for compliance
 */
contract FinovateToken is ERC20, ERC20Votes, ERC20Permit, Ownable {
    
    /// @notice Maximum supply of tokens (100 million)
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10 ** 18;
    
    /// @notice Minimum mint amount to prevent dust
    uint256 public constant MIN_MINT_AMOUNT = 1000 * 10 ** 18;
    
    /// @notice Maximum mintable amount per transaction
    uint256 public constant MAX_MINT_AMOUNT = 1_000_000 * 10 ** 18;
    
    /// @notice Treasury address for protocol fees
    address public treasury;
    
    /// @notice Rewards controller address
    address public rewardsController;
    
    /// @notice Transfer pause state
    bool public paused;
    
    /// @notice Blacklist mapping for compliance
    mapping(address => bool) public blacklist;
    
    /// @notice Events
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event RewardsControllerUpdated(address indexed oldController, address indexed newController);
    event TokensMinted(address indexed to, uint256 amount);
    event TokensBurned(address indexed from, uint256 amount);
    event TransferPaused(bool paused);
    event BlacklistUpdated(address indexed account, bool isBlacklisted);
    event TokensDelegated(address indexed from, address indexed to);

    /**
     * @dev Constructor
     * @param _treasury Treasury address for protocol
     */
    constructor(address _treasury)
        ERC20("Finovate", "FN")
        ERC20Permit("Finovate")
        Ownable(msg.sender)
    {
        require(_treasury != address(0), "Invalid treasury address");
        treasury = _treasury;
        
        // Mint initial supply to treasury (10% of max for initial distribution)
        uint256 initialMint = 10_000_000 * 10 ** 18; // 10M tokens
        _mint(_treasury, initialMint);
    }

    /**
     * @notice Override _update to include custom logic
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Votes) {
        // Check for blacklisted addresses
        require(!blacklist[from], "Sender is blacklisted");
        require(!blacklist[to], "Recipient is blacklisted");
        
        // Check pause state
        require(!paused || from == address(0) || to == address(0), "Transfers paused");
        
        // Check max supply
        if (from == address(0)) {
            require(totalSupply() + value <= MAX_SUPPLY, "MAX_SUPPLY exceeded");
        }
        
        super._update(from, to, value);
    }

    /**
     * @notice Mint new tokens (only owner or rewards controller)
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Mint to zero address");
        require(amount >= MIN_MINT_AMOUNT, "Mint amount too small");
        require(amount <= MAX_MINT_AMOUNT, "Mint amount too large");
        require(totalSupply() + amount <= MAX_SUPPLY, "Would exceed MAX_SUPPLY");
        
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    /**
     * @notice Mint tokens from rewards controller
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mintFromRewards(address to, uint256 amount) external {
        require(msg.sender == rewardsController, "Only rewards controller");
        require(to != address(0), "Mint to zero address");
        require(amount >= MIN_MINT_AMOUNT, "Mint amount too small");
        require(amount <= MAX_MINT_AMOUNT, "Mint amount too large");
        require(totalSupply() + amount <= MAX_SUPPLY, "Would exceed MAX_SUPPLY");
        
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    /**
     * @notice Burn tokens
     * @param amount Amount of tokens to burn
     */
    function burn(uint256 amount) external {
        require(amount > 0, "Burn amount must be > 0");
        _burn(msg.sender, amount);
        emit TokensBurned(msg.sender, amount);
    }

    /**
     * @notice Burn tokens from specific address (only owner)
     * @param account Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burnFrom(address account, uint256 amount) external onlyOwner {
        require(account != address(0), "Burn from zero address");
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
        emit TokensBurned(account, amount);
    }

    /**
     * @notice Set treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury address");
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    /**
     * @notice Set rewards controller
     * @param _rewardsController New rewards controller address
     */
    function setRewardsController(address _rewardsController) external onlyOwner {
        require(_rewardsController != address(0), "Invalid rewards controller");
        address oldController = rewardsController;
        rewardsController = _rewardsController;
        emit RewardsControllerUpdated(oldController, _rewardsController);
    }

    /**
     * @notice Pause/unpause transfers
     * @param _paused Pause state
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit TransferPaused(_paused);
    }

    /**
     * @notice Add/remove from blacklist
     * @param account Address to update
     * @param isBlacklisted Blacklist status
     */
    function setBlacklist(address account, bool isBlacklisted) external onlyOwner {
        require(account != address(0), "Invalid address");
        blacklist[account] = isBlacklisted;
        emit BlacklistUpdated(account, isBlacklisted);
    }

    /**
     * @notice Batch blacklist update
     * @param accounts Array of addresses
     * @param statuses Array of blacklist statuses
     */
    function batchSetBlacklist(address[] calldata accounts, bool[] calldata statuses) external onlyOwner {
        require(accounts.length == statuses.length, "Length mismatch");
        for (uint256 i = 0; i < accounts.length; i++) {
            require(accounts[i] != address(0), "Invalid address");
            blacklist[accounts[i]] = statuses[i];
            emit BlacklistUpdated(accounts[i], statuses[i]);
        }
    }

    /**
     * @notice Delegate voting power to delegatee
     * @param delegatee Address to delegate to
     */
    function delegate(address delegatee) public override(ERC20Votes) {
        super.delegate(delegatee);
        emit TokensDelegated(msg.sender, delegatee);
    }

    /**
     * @notice Get current voting power for an account
     * @param account Address to check
     * @return Voting power
     */
    function getVotes(address account) public view override returns (uint256) {
        return super.getVotes(account);
    }

    /**
     * @notice Get prior voting power at a specific block
     * @param account Address to check
     * @param blockNumber Block number to check
     * @return Voting power at that block
     */
    function getPastVotes(address account, uint256 blockNumber) public view override returns (uint256) {
        return super.getPastVotes(account, blockNumber);
    }

    /**
     * @notice Get current delegate for an account
     * @param account Address to check
     * @return Delegate address
     */
    function delegateOf(address account) external view returns (address) {
        return delegates(account);
    }

    /**
     * @notice Nonce override for ERC20Permit
     */
    function nonces(
        address owner
    ) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}

