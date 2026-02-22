const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { sanitizeUser } = require('../utils/sanitize');
const { 
  validateRegister, 
  validateLogin, 
  validateRoleUpdate 
} = require('../middleware/validators');

const router = express.Router();
const { authLimiter } = require('../middleware/rateLimiter');

router.put('/role', authenticateToken, validateRoleUpdate, async (req, res) => {
  const { role } = req.body;
  const userId = req.user.id;

  // Validate the role
  const allowedRoles = ['buyer', 'seller', 'shipment', 'investor'];
  if (!role || !allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role specified' });
  }

  try {
    // FIX: Use pool.query instead of User.updateRole
    const updateResult = await pool.query(
      `UPDATE users SET role = $1 WHERE id = $2 
       RETURNING id, email, wallet_address, company_name, first_name, last_name, role, created_at`,
      [role, userId]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'Role updated successfully', user: updateResult.rows[0] });
  } catch (error) {
    console.error('Role update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register new user
router.post('/register', authLimiter, validateRegister, async (req, res) => {
  console.log('Registration request body:', req.body);
  const { email, password, walletAddress, company_name, tax_id, first_name, last_name, role } = req.body;

  // Validate role - allow buyer, seller, investor, and shipment (arbitrators should be admin-only)
  const allowedRoles = ['buyer', 'seller', 'investor', 'shipment'];
  const userRole = allowedRoles.includes(role) ? role : 'seller'; // Default to 'seller'

  try {
    // Check if user already exists
    const userExists = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR wallet_address = $2',
      [email, walletAddress]
    );

    if (userExists.rows.length > 0) {
      return res.status(409).json({ 
        error: 'User with this email or wallet address already exists' 
      });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user - explicitly exclude password_hash from RETURNING clause
    const newUser = await pool.query(
      `INSERT INTO users 
       (email, password_hash, wallet_address, company_name, tax_id, first_name, last_name, role) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING id, email, wallet_address, company_name, first_name, last_name, role, created_at`,
      [email, passwordHash, walletAddress, company_name, tax_id, first_name, last_name, userRole]
    );

    const token = jwt.sign(
      { id: newUser.rows[0].id }, // Changed from userId to id
      process.env.JWT_SECRET,
      { expiresIn: '1Y' }
    );

    res.status(201).json({
      message: 'User created successfully',
      user: sanitizeUser(newUser.rows[0]),
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login user
router.post('/login', authLimiter, validateLogin, async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user by email - fetch password_hash separately for verification only
    const passwordResult = await pool.query(
      'SELECT id, password_hash, is_frozen FROM users WHERE email = $1',
      [email]
    );

    if (passwordResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { id, password_hash, is_frozen } = passwordResult.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if user is frozen
    if (is_frozen) {
      return res.status(403).json({ error: 'Account is frozen. Please contact support.' });
    }

    // Fetch user data WITHOUT password_hash
    const userResult = await pool.query(
      `SELECT id, email, wallet_address, company_name, 
              first_name, last_name, role, created_at 
       FROM users WHERE id = $1`,
      [id]
    );

    const user = userResult.rows[0];

    const token = jwt.sign(
      { id: user.id }, // Changed from userId to id
      process.env.JWT_SECRET,
      { expiresIn: '1Y' }
    );

    // Return user data (excluding password)
    res.json({
      message: 'Login successful',
      user: sanitizeUser(user),
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userResult = await pool.query(
      `SELECT id, email, wallet_address, company_name, 
              first_name, last_name, role, created_at 
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(sanitizeUser(userResult.rows[0]));
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout (client-side token removal)
router.post('/logout', (req, res) => {
  // Since we're using JWT, logout is handled client-side by removing the token
  res.json({ message: 'Logout successful' });
});

// Verify token validity
router.get('/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: sanitizeUser(req.user) });
});

module.exports = router;
