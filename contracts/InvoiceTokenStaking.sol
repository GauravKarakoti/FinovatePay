// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Simple staking contract for ERC-1155 invoice fraction tokens
contract InvoiceTokenStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Stake {
        address tokenAddress; // ERC-1155 contract
        uint256 tokenId;
        uint256 amount;
        uint256 stakingStart;
        uint256 lockUntil;
        uint256 apy; // APY in basis points (parts per 10k), e.g., 1000 = 10%
        uint256 rewardDebt;
        bool claimed;
    }

    // governance token distributed as rewards
    IERC20 public governanceToken;

    // protocol fee share in basis points taken as rewards
    uint256 public protocolFeeShareBP = 10; // 0.1% = 10 basis points

    // penalty rate in basis points for early withdrawal
    uint256 public earlyWithdrawalPenaltyBP = 500; // 5%

    // Baseline APY used for regular staking calls
    uint256 public defaultApyBP = 1000; // 10%

    // Hard APY ceiling; owner overrides cannot exceed this
    uint256 public maxApyBP = 2500; // 25%

    // total staked per token (by token contract + id)
    mapping(address => mapping(uint256 => uint256)) public totalStaked;

    // user stakes
    mapping(address => Stake[]) public stakes;

    event Staked(address indexed user, address tokenAddress, uint256 tokenId, uint256 amount, uint256 lockUntil, uint256 apy);
    event Unstaked(address indexed user, uint256 stakeIndex, uint256 amount, uint256 penalty);
    event RewardsClaimed(address indexed user, uint256 amount);

    constructor(address _governanceToken) Ownable(msg.sender) {
        require(_governanceToken != address(0), "Invalid governance token");
        governanceToken = IERC20(_governanceToken);
    }

    function setProtocolFeeShareBP(uint256 bp) external onlyOwner {
        protocolFeeShareBP = bp;
    }

    function setEarlyWithdrawalPenaltyBP(uint256 bp) external onlyOwner {
        earlyWithdrawalPenaltyBP = bp;
    }

    function setDefaultApyBP(uint256 apyBP) external onlyOwner {
        require(apyBP <= maxApyBP, "APY exceeds max");
        defaultApyBP = apyBP;
    }

    function setMaxApyBP(uint256 apyBP) external onlyOwner {
        require(apyBP >= defaultApyBP, "Max APY below default");
        maxApyBP = apyBP;
    }

    /// @notice Stake ERC-1155 tokens. Caller must approve this contract.
    function stake(address tokenAddress, uint256 tokenId, uint256 amount, uint256 lockDurationSeconds, uint256 apyBP) external nonReentrant {
        require(amount > 0, "Amount zero");

        uint256 effectiveApyBP = defaultApyBP;
        if (apyBP > 0) {
            require(msg.sender == owner(), "Only owner can override APY");
            require(apyBP <= maxApyBP, "APY exceeds max");
            effectiveApyBP = apyBP;
        }

        IERC1155(tokenAddress).safeTransferFrom(msg.sender, address(this), tokenId, amount, "");

        uint256 lockUntil = block.timestamp + lockDurationSeconds;

        stakes[msg.sender].push(Stake({
            tokenAddress: tokenAddress,
            tokenId: tokenId,
            amount: amount,
            stakingStart: block.timestamp,
            lockUntil: lockUntil,
            apy: effectiveApyBP,
            rewardDebt: 0,
            claimed: false
        }));

        totalStaked[tokenAddress][tokenId] += amount;

        emit Staked(msg.sender, tokenAddress, tokenId, amount, lockUntil, effectiveApyBP);
    }

    /// @notice Unstake (withdraw) a previously staked position (partial unstake not supported in first pass)
    function unstake(uint256 stakeIndex) external nonReentrant {
        require(stakeIndex < stakes[msg.sender].length, "Invalid stake index");
        Stake storage s = stakes[msg.sender][stakeIndex];
        require(s.amount > 0, "Already withdrawn");

        uint256 originalAmount = s.amount;
        address tokenAddress = s.tokenAddress;
        uint256 tokenId = s.tokenId;
        uint256 amount = originalAmount;
        uint256 penalty = 0;

        if (block.timestamp < s.lockUntil) {
            penalty = (originalAmount * earlyWithdrawalPenaltyBP) / 10000;
            amount = amount - penalty;
        }

        totalStaked[tokenAddress][tokenId] -= originalAmount;
        s.amount = 0;

        if (penalty > 0) {
            // Send penalty to owner (treasury).
            IERC1155(tokenAddress).safeTransferFrom(address(this), owner(), tokenId, penalty, "");
        }

        // transfer remaining back to user
        IERC1155(tokenAddress).safeTransferFrom(address(this), msg.sender, tokenId, amount, "");

        emit Unstaked(msg.sender, stakeIndex, amount, penalty);
    }

    /// @notice Distribute governance token rewards to user (manual claim based on simple time*amount*apy calculation)
    function claimRewards(uint256 stakeIndex) external nonReentrant {
        require(stakeIndex < stakes[msg.sender].length, "Invalid stake index");
        Stake storage s = stakes[msg.sender][stakeIndex];
        require(s.amount > 0, "No active stake");

        uint256 stakingPeriod = block.timestamp - s.stakingStart;
        // reward = amount * apy * seconds / (365 days) / 10000
        uint256 reward = (s.amount * s.apy * stakingPeriod) / (10000 * 365 days);

        require(reward > 0, "No rewards yet");

        // transfer governance tokens from contract
        require(governanceToken.balanceOf(address(this)) >= reward, "Insufficient rewards balance in contract");
        governanceToken.safeTransfer(msg.sender, reward);

        // reset stakingStart to now so rewards accrue from here
        s.stakingStart = block.timestamp;

        emit RewardsClaimed(msg.sender, reward);
    }

    // Allow contract to receive ERC-1155 tokens
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}
