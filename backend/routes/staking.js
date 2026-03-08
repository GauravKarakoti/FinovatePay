const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { createStake, unstake, getRewards, claimRewards } = require('../controllers/stakingController');

// Authentication middleware to populate req.user
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ message: 'Authorization header missing' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ message: 'Invalid authorization header format' });
    }

    const token = parts[1];

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }

        req.user = user;
        next();
    });
};

// Protected staking routes
router.post('/stake', authenticateToken, createStake);
router.post('/unstake', authenticateToken, unstake);
router.get('/rewards', authenticateToken, getRewards);
router.post('/rewards/claim', authenticateToken, claimRewards);
module.exports = router;
