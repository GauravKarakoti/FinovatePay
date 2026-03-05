const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { sanitizeUser } = require('../utils/sanitize');
const { 
  generateToken, 
  generateTokens, 
  generateRefreshToken,
  verifyToken,
  getRefreshTokenExpiration 
} = require('../utils/jwt');
const { 
  validateRegister, 
  validateLogin, 
  validateRoleUpdate 
} = require('../middleware/validators');
const { AppError, ErrorCodes } = require('../utils/AppError');
const RefreshToken = require('../models/RefreshToken');

const router = express.Router();
const { authLimiter } = require('../middleware/rateLimiter');

// Helper to parse refresh token expiration to milliseconds
const getRefreshTokenExpirationMs = () => {
  const exp = getRefreshTokenExpiration();
  const unit = exp.slice(-1);
  const value = parseInt(exp);
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] || 86400000);
};

// Helper to get client info from request
const getClientInfo = (req) => ({
  ipAddress: req.ip || req.connection.remoteAddress,
  userAgent: req.headers['user-agent'],
  deviceInfo: req.headers['x-device-info'] || null
});

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

    const token = generateToken(newUser.rows[0]);

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
      return res.status(401).json({ 
        success: false,
        error: {
          message: 'Invalid credentials',
          code: 'AUTH_INVALID_CREDENTIALS'
        }
      });
    }

    const { id, password_hash, is_frozen } = passwordResult.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, password_hash);
    if (!validPassword) {
      return res.status(401).json({ 
        success: false,
        error: {
          message: 'Invalid credentials',
          code: 'AUTH_INVALID_CREDENTIALS'
        }
      });
    }

    // Check if user is frozen
    if (is_frozen) {
      return res.status(403).json({ 
        success: false,
        error: {
          message: 'Account is frozen. Please contact support.',
          code: 'AUTH_ACCOUNT_FROZEN'
        }
      });
    }

    // Fetch user data WITHOUT password_hash
    const userResult = await pool.query(
      `SELECT id, email, wallet_address, company_name, 
              first_name, last_name, role, created_at 
       FROM users WHERE id = $1`,
      [id]
    );

    const user = userResult.rows[0];

    // Generate tokens
    const tokens = generateTokens(user);
    const clientInfo = getClientInfo(req);
    
    // Store refresh token in database
    const expiresAt = new Date(Date.now() + getRefreshTokenExpirationMs());
    await RefreshToken.create({
      userId: user.id,
      token: tokens.refreshToken,
      expiresAt,
      ...clientInfo
    });

    // Return user data with tokens
    res.json({
      success: true,
      message: 'Login successful',
      user: sanitizeUser(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false,
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      }
    });
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

// Logout (revokes refresh token)
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const refreshToken = req.body.refreshToken;
    
    if (refreshToken) {
      // Revoke the specific refresh token
      await RefreshToken.revoke(refreshToken, 'user_logout');
    }
    
    res.json({ 
      success: true,
      message: 'Logout successful' 
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.json({ 
      success: true,
      message: 'Logout successful' 
    });
  }
});

// Logout from all devices
router.post('/logout-all', authenticateToken, async (req, res) => {
  try {
    const count = await RefreshToken.revokeAllForUser(req.user.id, 'logout_all_devices');
    
    res.json({ 
      success: true,
      message: `Logged out from ${count} device(s)`,
      revokedCount: count
    });
  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({ 
      success: false,
      error: {
        message: 'Failed to logout from all devices',
        code: 'INTERNAL_ERROR'
      }
    });
  }
});

// Refresh access token
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Refresh token required',
        code: 'AUTH_REFRESH_TOKEN_MISSING'
      }
    });
  }

  try {
    // Verify the refresh token JWT
    const decoded = verifyToken(refreshToken, 'refresh');
    
    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid refresh token',
          code: 'AUTH_REFRESH_TOKEN_INVALID'
        }
      });
    }

    // Check if token exists in database and is valid
    const storedToken = await RefreshToken.findValidToken(refreshToken);
    
    if (!storedToken) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Refresh token expired or revoked',
          code: 'AUTH_REFRESH_TOKEN_EXPIRED'
        }
      });
    }

    // Optional: Check for potential compromise
    const currentIp = req.ip || req.connection.remoteAddress;
    const isCompromised = await RefreshToken.checkCompromised(refreshToken, currentIp);
    
    if (isCompromised) {
      // Revoke all tokens for this user for security
      await RefreshToken.revokeAllForUser(decoded.id, 'potential_compromise');
      return res.status(401).json({
        success: false,
        error: {
          message: 'Security concern detected. Please login again.',
          code: 'AUTH_SECURITY_CONCERN'
        }
      });
    }

    // Fetch user data
    const userResult = await pool.query(
      `SELECT id, email, wallet_address, company_name, 
              first_name, last_name, role, created_at, is_frozen
       FROM users WHERE id = $1`,
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'User not found',
          code: 'AUTH_USER_NOT_FOUND'
        }
      });
    }

    const user = userResult.rows[0];

    if (user.is_frozen) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Account is frozen',
          code: 'AUTH_ACCOUNT_FROZEN'
        }
      });
    }

    // Token rotation: revoke old refresh token
    await RefreshToken.revoke(refreshToken, 'token_rotation');

    // Generate new tokens
    const tokens = generateTokens(user);
    const clientInfo = getClientInfo(req);
    
    // Store new refresh token
    const expiresAt = new Date(Date.now() + getRefreshTokenExpirationMs());
    await RefreshToken.create({
      userId: user.id,
      token: tokens.refreshToken,
      expiresAt,
      ...clientInfo
    });

    res.json({
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to refresh token',
        code: 'INTERNAL_ERROR'
      }
    });
  }
});

// Get active sessions
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const sessions = await RefreshToken.findByUserId(req.user.id);
    const stats = await RefreshToken.getStats(req.user.id);
    
    res.json({
      success: true,
      sessions,
      stats
    });
  } catch (error) {
    console.error('Sessions fetch error:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch sessions',
        code: 'INTERNAL_ERROR'
      }
    });
  }
});

// Verify token validity
router.get('/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: sanitizeUser(req.user) });
});

module.exports = router;
