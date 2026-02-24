const express = require('express');
const router = express.Router();
const { relayTransaction } = require('../controllers/relayerController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { relayerLimiter } = require('../middleware/rateLimiter');
const { validateRelayTransaction } = require('../middleware/validators');

// Secure the relayer endpoint with authentication, authorization, rate limiting, and validation
router.post('/', 
  authenticateToken,           // ✅ Require authentication
  requireRole(['admin']),       // ✅ Restrict to admins only
  relayerLimiter,              // ✅ Add rate limiting (10 req/15min)
  validateRelayTransaction,    // ✅ Validate input format
  relayTransaction
);

module.exports = router;
