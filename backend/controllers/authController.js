const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const errorResponse = require('../utils/errorResponse');

// Utility function to sanitize user object (remove sensitive fields)
const sanitizeUser = (user) => {
  const { password, password_hash, ...sanitizedUser } = user;
  return sanitizedUser;
};


// --- REGISTER USER ---
exports.register = async (req, res) => {
  // 1. Get data from the form
  const { name, email, password, walletAddress, companyName, phone } = req.body;


  try {
    // 2. Check if user already exists
    const userCheck = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR wallet_address = $2', 
      [email, walletAddress]
    );

    
    if (userCheck.rows.length > 0) {
      return errorResponse(res, 'User already exists with this Email or Wallet', 400);
    }

    // 3. Encrypt the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 4. Save to Database (Force role to 'seller')
    const newUser = await pool.query(
      `INSERT INTO users (name, email, password, wallet_address, company_name, phone, role, kyc_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'seller', 'pending') 
       RETURNING *`,
      [name, email, hashedPassword, walletAddress, companyName, phone]
    );


    // 5. Create Login Token
    const token = jwt.sign(
      { id: newUser.rows[0].id, role: newUser.rows[0].role }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // 6. Set HttpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
    });

    res.json({ user: sanitizeUser(newUser.rows[0]), token });
  } catch (err) {
    console.error("❌ Registration Error:", err.message);
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
      return errorResponse(res, 'Invalid credentials', 400);
    }

    // 2. Check password
    const isMatch = await bcrypt.compare(password, user.rows[0].password);
    if (!isMatch) {
      return errorResponse(res, 'Invalid credentials', 400);
    }

    // 3. Create and set token in HttpOnly cookie
    const token = jwt.sign(
      { id: user.rows[0].id, role: user.rows[0].role }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // Set HttpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
    });

    res.json({ user: sanitizeUser(user.rows[0]), token });
  } catch (err) {
    console.error("❌ Login Error:", err.message);
    return errorResponse(res, 'Server error', 500);
  }
};
