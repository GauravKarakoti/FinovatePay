const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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
  validateRoleUpdate,
  validateForgotPassword,
  validateResetPassword,
  validateChangePassword
} = require('../middleware/validators');
const { AppError, ErrorCodes } = require('../utils/AppError');
const RefreshToken = require('../models/RefreshToken');

const router = express.Router();
const { authLimiter, forgotPasswordLimiter } = require('../middleware/rateLimiter');

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
    // Get current user info
    const userResult = await pool.query(
      'SELECT id, email, role, kyc_status FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentUser = userResult.rows[0];
    const currentRole = currentUser.role;

    // Prevent no-op updates
    if (currentRole === role) {
      return res.status(400).json({ error: 'User already has this role' });
    }

    // SECURITY: Restrict role escalation to 'investor'
    // 'investor' role requires KYC verification or admin approval
    if (role === 'investor') {
      // Check if user has completed KYC verification
      if (currentUser.kyc_status !== 'verified') {
        return res.status(403).json({
          error: 'Access Denied',
          reason: 'Investor role requires KYC verification. Please complete KYC before upgrading to investor.'
        });
      }
    }

    // SECURITY: Prevent direct role changes to 'shipment' without admin
    // 'shipment' role is for arbitrators and should only be granted by admin
    if (role === 'shipment') {
      return res.status(403).json({
        error: 'Access Denied',
        reason: 'Shipment role can only be assigned by administrators.'
      });
    }

    // FIX: Update role with proper authorization checks
    const updateResult = await pool.query(
      `UPDATE users SET role = $1 WHERE id = $2 
       RETURNING id, email, wallet_address, company_name, first_name, last_name, role, created_at`,
      [role, userId]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log the role change for audit trail
    console.log(`[AUDIT] User ${userId} changed role from ${currentRole} to ${role}`);
    
    res.json({
      message: 'Role updated successfully',
      user: updateResult.rows[0]
    });
  } catch (error) {
    console.error('Role update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin-only endpoint to assign roles (bypasses user self-service restrictions)
// This allows admins to grant restricted roles like 'shipment' or 'investor'
router.put('/admin/assign-role', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    const adminCheck = await pool.query(
      'SELECT role FROM users WHERE id = $1',
      [req.user.id]
    );

    if (adminCheck.rows.length === 0 || adminCheck.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied. Admin privileges required.' });
    }

    const { userId, role } = req.body;

    if (!userId || !role) {
      return res.status(400).json({ error: 'userId and role are required' });
    }

    const allowedRoles = ['buyer', 'seller', 'shipment', 'investor'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role specified' });
    }

    // Verify target user exists
    const userResult = await pool.query(
      'SELECT id, email, role FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    const targetUser = userResult.rows[0];

    // Update the role
    const updateResult = await pool.query(
      `UPDATE users SET role = $1 WHERE id = $2 
       RETURNING id, email, wallet_address, company_name, first_name, last_name, role, created_at`,
      [role, userId]
    );

    // Log the admin role assignment for security audit
    console.log(`[AUDIT] Admin ${req.user.id} assigned role '${role}' to user ${userId} (previous: ${targetUser.role})`);

    res.json({
      message: 'Role assigned successfully by admin',
      user: updateResult.rows[0]
    });
  } catch (error) {
    console.error('Admin role assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
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

    // Set HttpOnly cookie for additional security (defense-in-depth)
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

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

// Forgot Password - Request password reset
router.post('/forgot-password', forgotPasswordLimiter, validateForgotPassword, async (req, res) => {
  const { email } = req.body;

  try {
    // Check if user exists
    const userResult = await pool.query(
      'SELECT id, email, first_name FROM users WHERE email = $1',
      [email]
    );

    // Always return success to prevent email enumeration
    if (userResult.rows.length === 0) {
      return res.json({ 
        success: true, 
        message: 'If an account exists with this email, a password reset link has been sent.' 
      });
    }

    const user = userResult.rows[0];

    // Generate secure random token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Store token in database
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, resetToken, expiresAt]
    );

    // Create reset link
    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    // Send email
    await sendEmail({
      to: user.email,
      subject: 'Reset Your Password - FinovatePay',
      template: 'password-reset',
      context: {
        resetLink,
        userName: user.first_name || 'User'
      }
    });

    res.json({ 
      success: true, 
      message: 'If an account exists with this email, a password reset link has been sent.' 
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset Password - Reset password with token
router.post('/reset-password', authLimiter, validateResetPassword, async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    // Find valid token
    const tokenResult = await pool.query(
      `SELECT user_id, expires_at, used 
       FROM password_reset_tokens 
       WHERE token = $1`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const resetToken = tokenResult.rows[0];

    // Check if token is already used
    if (resetToken.used) {
      return res.status(400).json({ error: 'Reset token has already been used' });
    }

    // Check if token is expired
    if (new Date() > new Date(resetToken.expires_at)) {
      return res.status(400).json({ error: 'Reset token has expired' });
    }

    // Hash new password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, resetToken.user_id]
    );

    // Mark token as used
    await pool.query(
      'UPDATE password_reset_tokens SET used = TRUE, used_at = CURRENT_TIMESTAMP WHERE token = $1',
      [token]
    );

    res.json({ 
      success: true, 
      message: 'Password reset successful. You can now login with your new password.' 
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change Password - Authenticated users can change their password
router.put('/change-password', authenticateToken, validateChangePassword, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  try {
    // Get current password hash
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, userId]
    );

    res.json({ 
      success: true, 
      message: 'Password changed successfully' 
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
