const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const { checkCompliance } = require('../controllers/kycController');

// All admin routes require authentication and admin role
router.use(authenticateToken);
router.use(requireRole('admin'));

// Get all users
router.get('/users', async (req, res) => {
  try {
    const pool = require('../config/database');
    const result = await pool.query(
      'SELECT id, email, wallet_address, company_name, kyc_status, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all invoices
router.get('/invoices', async (req, res) => {
  try {
    const pool = require('../config/database');
    const result = await pool.query(
      'SELECT * FROM invoices ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user role
router.patch('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    const validRoles = ['user', 'admin', 'arbitrator'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    const user = await User.updateRole(id, role);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check wallet compliance
router.post('/compliance/check', async (req, res) => {
  await checkCompliance(req, res);
});

// Freeze user account
router.post('/users/:id/freeze', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = require('../config/database');
    
    await pool.query(
      'UPDATE users SET is_frozen = TRUE WHERE id = $1',
      [id]
    );
    
    res.json({ success: true, message: 'User account frozen' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unfreeze user account
router.post('/users/:id/unfreeze', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = require('../config/database');
    
    await pool.query(
      'UPDATE users SET is_frozen = FALSE WHERE id = $1',
      [id]
    );
    
    res.json({ success: true, message: 'User account unfrozen' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;