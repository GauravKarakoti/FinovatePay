const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const marketController = require('../controllers/marketController');

// All market routes require authentication
router.use(authenticateToken);

// GET /api/market/prices?crop=Wheat
router.get('/prices', marketController.getMarketPrices);

module.exports = router;