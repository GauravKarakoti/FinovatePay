const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();
const kycController = require('../controllers/kycController');

// Route to initiate Aadhaar verification
router.post('/initiate', authenticateToken, kycController.initiateKYC);

// Route to verify OTP and complete process
router.post('/verify-otp', authenticateToken, kycController.verifyKYCOtp);

// Check KYC status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const kycResult = await pool.query(
      `SELECT kv.*, u.kyc_status, u.kyc_risk_level 
      FROM kyc_verifications kv
      INNER JOIN users u ON kv.user_id = u.id
      WHERE kv.user_id = $1 
      ORDER BY kv.created_at DESC LIMIT 1`,
      [req.user.id]
    );
    
    if (kycResult.rows.length === 0) {
      return res.json({
        status: 'not_started',
        message: 'KYC verification not initiated'
      });
    }

    res.json(kycResult.rows[0]);
  } catch (error) {
    console.error('KYC status check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all KYC verifications (admin only)
router.get('/admin/verifications', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    const userResult = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const verifications = await pool.query(
      `SELECT kv.*, u.email, u.wallet_address, u.company_name 
       FROM kyc_verifications kv
       INNER JOIN users u ON kv.user_id = u.id
       ORDER BY kv.created_at DESC`
    );

    res.json(verifications.rows);
  } catch (error) {
    console.error('KYC verifications fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manual KYC override (admin only)
router.post('/admin/override', authenticateToken, async (req, res) => {
  const { user_id, status, risk_level, reason } = req.body;

  try {
    // Check if user is admin
    const userResult = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Create manual verification record
    await pool.query(
      `INSERT INTO kyc_verifications 
       (user_id, status, risk_level, details, verified_at, manual_override) 
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, true)`,
      [user_id, status, risk_level, reason]
    );

    // Update user record
    await pool.query(
      'UPDATE users SET kyc_status = $1, kyc_risk_level = $2 WHERE id = $3',
      [status, risk_level, user_id]
    );

    // Emit real-time update
    const io = req.app.get('io');
    io.to(`user-${user_id}`).emit('kyc-status-update', {
      status,
      riskLevel: risk_level,
      details: reason,
      manualOverride: true
    });

    res.json({ success: true, message: 'KYC status manually updated' });
  } catch (error) {
    console.error('KYC override error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;