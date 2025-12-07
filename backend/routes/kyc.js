const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { ethers } = require('ethers');
const { getSigner, contractAddresses } = require('../config/blockchain');
const ComplianceManagerArtifact = require('../../deployed/ComplianceManager.json');
const router = express.Router();
const kycController = require('../controllers/kycController');

router.post('/initiate', authenticateToken, kycController.initiateKYC);

// Route to verify OTP and complete process
router.post('/verify-otp', authenticateToken, kycController.verifyKYCOtp);

router.post('/verify', authenticateToken, async (req, res) => {
  // FIX: Destructure camelCase properties to match the frontend form data
  const {
    firstName,
    lastName,
    dob,
    address,
    city,
    country,
    idType,
    idNumber,
    id_image_url // Assuming this comes from a file upload service
  } = req.body;

  try {
    // Store KYC data in the database
    await pool.query(
      `INSERT INTO kyc_verifications 
       (user_id, first_name, last_name, dob, address, city, country, id_type, id_number, id_image_url, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
      // FIX: Use the corrected camelCase variables in the query
      [req.user.id, firstName, lastName, dob, address, city, country, idType, idNumber, id_image_url]
    );

    // Update user KYC status to 'pending'
    await pool.query('UPDATE users SET kyc_status = $1 WHERE id = $2', ['pending', req.user.id]);

    // Simulate response from KYC provider
    setTimeout(async () => {
      try {
        const userResult = await pool.query('SELECT wallet_address FROM users WHERE id = $1', [req.user.id]);
        if (userResult.rows.length === 0) {
          console.error(`KYC Callback Error: User with ID ${req.user.id} not found.`);
          return;
        }
        const userWalletAddress = userResult.rows[0].wallet_address;

        // Randomly determine verification result for simulation
        const isVerified = Math.random() > 0.3; // 70% success rate
        const io = req.app.get('io');
        
        if (isVerified) {
          try {
            // --- STEP 1: On-Chain Transaction ---
            const signer = getSigner();
            const complianceManager = new ethers.Contract(
                contractAddresses.complianceManager,
                ComplianceManagerArtifact.abi,
                signer
            );

            console.log(`Updating KYC status on-chain for wallet: ${userWalletAddress}`);
            const tx = await complianceManager.verifyKYC(userWalletAddress);
            await tx.wait(); // Wait for the transaction to be mined
            console.log(`On-chain KYC verification successful. Tx Hash: ${tx.hash}`);
            
            // --- STEP 2: Database Update (only runs if Step 1 succeeds) ---
            console.log(`Updating database status to 'verified' for user ID: ${req.user.id}`);
            const riskLevel = 'low';
            
            console.log("User ID: ",req.user.id);
            // Update the specific verification record
            await pool.query(
                `UPDATE kyc_verifications SET status = 'verified', risk_level = $1, verified_at = CURRENT_TIMESTAMP WHERE user_id = $2 AND status = 'pending'`,
                [riskLevel, req.user.id]
            );
            
            // Update the main users table
            await pool.query(
                'UPDATE users SET kyc_status = \'verified\', kyc_risk_level = $1 WHERE id = $2',
                [riskLevel, req.user.id]
            );

            // --- STEP 3: Notify Frontend ---
            const io = req.app.get('io');
            io.to(`user-${req.user.id}`).emit('kyc-status-update', { status: 'verified', riskLevel });

          } catch (contractError) {
            console.error('On-chain KYC verification failed:', contractError);
            // If the contract call fails, the database is updated to 'failed'
            await pool.query(
                `UPDATE kyc_verifications SET status = 'failed', details = $1 WHERE user_id = $2 AND status = 'pending'`, 
                ['On-chain transaction failed.', req.user.id]
            );
            await pool.query(
                'UPDATE users SET kyc_status = \'failed\' WHERE id = $1', 
                [req.user.id]
            );
          }
        } else {
          // If verification fails, update database accordingly
          const riskLevel = 'high';
          await pool.query(
            `UPDATE kyc_verifications SET status = 'failed', risk_level = $1, verified_at = CURRENT_TIMESTAMP WHERE user_id = $2 AND status = 'pending'`,
            [riskLevel, req.user.id]
          );
          await pool.query(
            'UPDATE users SET kyc_status = \'failed\', kyc_risk_level = $1 WHERE id = $2',
            [riskLevel, req.user.id]
          );
          io.to(`user-${req.user.id}`).emit('kyc-status-update', { status: 'failed', riskLevel });
        }
      } catch (err) {
        console.error('Error during KYC processing:', err);
        // Handle errors (e.g., if blockchain transaction fails)
        await pool.query(`UPDATE kyc_verifications SET status = 'failed', details = $1 WHERE user_id = $2 AND status = 'pending'`, [err.message, req.user.id]);
        await pool.query('UPDATE users SET kyc_status = \'failed\' WHERE id = $1', [req.user.id]);
        const io = req.app.get('io');
        io.to(`user-${req.user.id}`).emit('kyc-status-update', { status: 'failed', riskLevel: 'high' });
      }
    }, 5000); // Simulate 5-second processing time

    res.json({
      success: true,
      message: 'KYC verification initiated. This may take a few moments.',
      status: 'pending'
    });
  } catch (error) {
    console.error('KYC initiation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    console.log("KYC Result: ", kycResult.rows)
    
    if (kycResult.rows.length === 0) {
      return res.json({
        status: 'not_started',
        message: 'KYC verification not initiated'
      });
    }
    console.log("KYC Status: ", kycResult.rows[0])

    res.json(kycResult.rows[0]);
  } catch (error) {
    console.error('KYC status check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Webhook for KYC provider to update status (called by KYC service)
router.post('/webhook/status', async (req, res) => {
  // Verify webhook signature (in real implementation)
  const signature = req.headers['x-kyc-signature'];
  // Add signature verification logic here

  const { user_id, status, risk_level, details } = req.body;

  try {
    // Update KYC verification record
    await pool.query(
      `UPDATE kyc_verifications 
       SET status = $1, risk_level = $2, details = $3, verified_at = CURRENT_TIMESTAMP 
       WHERE user_id = $4 AND status = 'pending'`,
      [status, risk_level, details, user_id]
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
      details
    });

    res.json({ success: true });
  } catch (error) {
    console.error('KYC webhook error:', error);
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