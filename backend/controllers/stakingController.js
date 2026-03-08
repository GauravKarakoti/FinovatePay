const Staking = require('../models/Staking');
const { getSigner, contractAddresses } = require('../config/blockchain');
const fs = require('fs');
const path = require('path');

const deployedDir = path.join(__dirname, '..', '..', 'deployed');
let stakingAbi = null;
try {
  stakingAbi = require(path.join(deployedDir, 'InvoiceTokenStaking.json')).abi;
} catch (err) {
  // ABI may not exist yet; endpoints still work for DB side
}

const createStake = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const { tokenAddress, tokenId, amount, lockDurationSeconds, apyBP } = req.body;
    if (!tokenAddress || !tokenId || !amount) {
      return res.status(400).json({ message: 'Missing parameters' });
    }

    const lockUntil = new Date(Date.now() + (lockDurationSeconds || 0) * 1000);

    const stake = await Staking.createStake({
      userId: user.id,
      tokenAddress,
      tokenId: String(tokenId),
      amount,
      lockUntil,
      apyBP: apyBP || 0,
    });

    return res.status(201).json({ stake });
  } catch (err) {
    next(err);
  }
};

const unstake = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const { stakeId } = req.body;
    if (!stakeId) return res.status(400).json({ message: 'stakeId required' });

    const stake = await Staking.getById(stakeId);
    if (!stake || stake.user_id !== user.id) return res.status(404).json({ message: 'Stake not found' });

    // Simple early-withdrawal penalty: if now < lock_until, compute penalty
    const now = new Date();
    let penalty = 0;
    if (stake.lock_until && now < new Date(stake.lock_until)) {
      // 5% penalty conservative default
      penalty = Number(stake.amount) * 0.05;
    }

    // Remove DB record
    await Staking.remove(stakeId);

    return res.json({ unstaked: true, penalty });
  } catch (err) {
    next(err);
  }
};

const getRewards = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const stakes = await Staking.getUserStakes(user.id);

    // Compute simple accrued rewards: amount * apybp * seconds / (365d * 10000)
    const rewards = stakes.map((s) => {
      const lastClaim = s.last_claimed_at ? new Date(s.last_claimed_at) : new Date(s.staking_start);
      const seconds = Math.max(0, Math.floor((Date.now() - lastClaim.getTime()) / 1000));
      const reward = (Number(s.amount) * (s.apy_bp || 0) * seconds) / (10000 * 365 * 24 * 3600);
      return {
        id: s.id,
        tokenAddress: s.token_address,
        tokenId: s.token_id,
        amount: s.amount,
        accruedReward: reward,
      };
    });

    return res.json({ rewards });
  } catch (err) {
    next(err);
  }
};

const claimRewards = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const { stakeId } = req.body;
    if (!stakeId) return res.status(400).json({ message: 'stakeId required' });

    const stake = await Staking.getById(stakeId);
    if (!stake || stake.user_id !== user.id) return res.status(404).json({ message: 'Stake not found' });

    const lastClaim = stake.last_claimed_at ? new Date(stake.last_claimed_at) : new Date(stake.staking_start);
    const seconds = Math.max(0, Math.floor((Date.now() - lastClaim.getTime()) / 1000));
    const reward = (Number(stake.amount) * (stake.apy_bp || 0) * seconds) / (10000 * 365 * 24 * 3600);

    // Mark claimed in DB
    await Staking.markClaimed(stakeId);

    // Note: For on-chain transfers, integration with deployed governance token contract would be required.
    // For now we return the computed reward amount and expect off-chain settlement or later integration.

    return res.json({ claimed: true, reward });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createStake,
  unstake,
  getRewards,
  claimRewards,
};
