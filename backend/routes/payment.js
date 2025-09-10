const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const {
  releaseEscrow,
  raiseDispute
} = require('../controllers/escrowController');

// All payment routes require authentication and KYC
router.use(authenticateToken);
router.use(requireKYC);

// Release escrow funds
router.post('/escrow/release', async (req, res) => {
  await releaseEscrow(req, res);
});

// Raise a dispute
router.post('/escrow/dispute', async (req, res) => {
  await raiseDispute(req, res);
});

module.exports = router;