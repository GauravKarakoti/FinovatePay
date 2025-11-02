const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');
const router = express.Router();

router.put('/role', authenticateToken, async (req, res) => {
  const { role } = req.body;
  const userId = req.user.id;

  // Validate the role
  const allowedRoles = ['buyer', 'seller', 'shipment', 'investor'];
  if (!role || !allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role specified' });
  }

  try {
    const updatedUser = await User.updateRole(userId, role);
    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'Role updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Role update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register new user
router.post('/register', async (req, res) => {
  console.log('Registration request body:', req.body);
  const { email, password, walletAddress, company_name, tax_id, first_name, last_name } = req.body;

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

    // Create user
    const newUser = await pool.query(
      `INSERT INTO users 
       (email, password_hash, wallet_address, company_name, tax_id, first_name, last_name) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, email, wallet_address, company_name, created_at`,
      [email, passwordHash, walletAddress, company_name, tax_id, first_name, last_name]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser.rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'User created successfully',
      user: newUser.rows[0],
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login user
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user by email
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if user is frozen
    if (user.is_frozen) {
      return res.status(403).json({ error: 'Account is frozen. Please contact support.' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Return user data (excluding password)
    const { password_hash, ...userWithoutPassword } = user;

    res.json({
      message: 'Login successful',
      user: userWithoutPassword,
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
      `SELECT id, email, wallet_address, company_name, tax_id, 
              first_name, last_name, kyc_status, role, created_at 
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(userResult.rows[0]);
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
  res.json({ valid: true, user: req.user });
});

module.exports = router;