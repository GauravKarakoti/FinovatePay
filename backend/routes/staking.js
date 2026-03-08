const express = require('express');
const router = express.Router();
const { createStake, unstake, getRewards, claimRewards } = require('../controllers/stakingController');

// Authentication middleware should populate req.user
router.post('/stake', createStake);
router.post('/unstake', unstake);
router.get('/rewards', getRewards);
router.post('/rewards/claim', claimRewards);

module.exports = router;
