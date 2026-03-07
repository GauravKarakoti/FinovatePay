const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const errorResponse = require('../utils/errorResponse');
const AuditService = require('../services/auditService');
const { generateToken } = require('../utils/jwt');

// Utility function to sanitize user object (remove sensitive fields)
const sanitizeUser = (user) => {
  const { password, password_hash, ...sanitizedUser } = user;
  return sanitizedUser;
};

// Valid user roles
const VALID_ROLES = ['buyer', 'seller', 'arbitrator', 'investor'];

// --- REGISTER USER ---
exports.register = async (req, res) => {
  // 1. Get data from the form
  const { name, email, password, walletAddress, companyName, phone, role } = req.body;

  try {
    // 2. Validate role parameter (default to 'seller' if not provided)
    const userRole = role && VALID_ROLES.includes(role) ? role : 'seller';

    // 3. Check if user already exists
    const userCheck = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR wallet_address = $2',
      [email, walletAddress]
    );

    if (userCheck.rows.length > 0) {
      // Log failed registration attempt
      await AuditService.logFailedAuth({
        email,
        userId: null,
        reason: 'User already exists',
        ipAddress: req.auditData?.ipAddress,
        userAgent: req.auditData?.userAgent,
        errorMessage: 'User already exists with this Email or Wallet',
      });
      return errorResponse(res, 'User already exists with this Email or Wallet', 400);
    }

    // 4. Encrypt the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 5. Save to Database with the specified role
    const newUser = await pool.query(
      `INSERT INTO users (name, email, password, wallet_address, company_name, phone, role, kyc_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') 
       RETURNING *`,
      [name, email, hashedPassword, walletAddress, companyName, phone, userRole]
    );


    // 5. Create Login Token
    const token = generateToken(newUser.rows[0]);

    // 6. Log successful registration
    await AuditService.logUserAuth({
      type: 'register',
      userId: newUser.rows[0].id,
      email,
      wallet: walletAddress,
      role: 'seller',
      action: 'user_registered',
      status: 'SUCCESS',
      ipAddress: req.auditData?.ipAddress,
      userAgent: req.auditData?.userAgent,
    });

    // 7. Set HttpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    });

    res.json({ user: sanitizeUser(newUser.rows[0]) });
  } catch (err) {
    console.error("❌ Registration Error:", err.message);
    // Log registration error
    await AuditService.logFailedAuth({
      email,
      userId: null,
      reason: 'Server error',
      ipAddress: req.auditData?.ipAddress,
      userAgent: req.auditData?.userAgent,
      errorMessage: err.message,
    });
    console.error('❌ Registration Error:', err.message);
    return errorResponse(res, 'Server error during registration', 500);
  }
};

// --- LOGIN USER ---
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Find user by email
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) {
      // Log failed login attempt
      await AuditService.logFailedAuth({
        email,
        userId: null,
        reason: 'Invalid credentials - user not found',
        ipAddress: req.auditData?.ipAddress,
        userAgent: req.auditData?.userAgent,
        errorMessage: 'Invalid credentials',
      });
      return errorResponse(res, 'Invalid credentials', 400);
    }

    // 2. Check password
    const isMatch = await bcrypt.compare(password, user.rows[0].password);
    if (!isMatch) {
      // Log failed login attempt
      await AuditService.logFailedAuth({
        email,
        userId: user.rows[0].id,
        reason: 'Invalid password',
        ipAddress: req.auditData?.ipAddress,
        userAgent: req.auditData?.userAgent,
        errorMessage: 'Invalid credentials',
      });
      return errorResponse(res, 'Invalid credentials', 400);
    }

    // 3. Check if user account is frozen/disabled
    if (user.rows[0].is_frozen) {
      await AuditService.logFailedAuth({
        email,
        userId: user.rows[0].id,
        reason: 'Account frozen',
        ipAddress: req.auditData?.ipAddress,
        userAgent: req.auditData?.userAgent,
        errorMessage: 'Account is frozen',
      });
      return errorResponse(res, 'Account is frozen. Please contact support.', 403);
    }

    // 4. Create and set token in HttpOnly cookie
    const token = jwt.sign(
      { id: user.rows[0].id, role: user.rows[0].role }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );
    // 3. Create and set token in HttpOnly cookie
    const token = generateToken(user.rows[0]);

    // 5. Log successful login
    await AuditService.logUserAuth({
      type: 'login',
      userId: user.rows[0].id,
      email,
      wallet: user.rows[0].wallet_address,
      role: user.rows[0].role,
      action: 'user_login',
      status: 'SUCCESS',
      ipAddress: req.auditData?.ipAddress,
      userAgent: req.auditData?.userAgent,
    });

    // Set HttpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    });

    res.json({ user: sanitizeUser(user.rows[0]) });
  } catch (err) {
    console.error("❌ Login Error:", err.message);
    await AuditService.logFailedAuth({
      email,
      userId: null,
      reason: 'Server error',
      ipAddress: req.auditData?.ipAddress,
      userAgent: req.auditData?.userAgent,
      errorMessage: err.message,
    });
    console.error('❌ Login Error:', err.message);
    return errorResponse(res, 'Server error', 500);
  }
};
