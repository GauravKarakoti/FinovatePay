const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// --- REGISTER USER ---
exports.register = async (req, res) => {
  // 1. Get data from the form
  const { name, email, password, wallet_address, company_name, phone } = req.body;

  try {
    // 2. Check if user already exists
    const userCheck = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR wallet_address = $2', 
      [email, wallet_address]
    );
    
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists with this Email or Wallet' });
    }

    // 3. Encrypt the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 4. Save to Database (Force role to 'seller')
    const newUser = await pool.query(
      `INSERT INTO users (name, email, password, wallet_address, company_name, phone, role, kyc_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'seller', 'pending') 
       RETURNING *`,
      [name, email, hashedPassword, wallet_address, company_name, phone]
    );

    // 5. Create Login Token
    const token = jwt.sign(
      { id: newUser.rows[0].id, role: newUser.rows[0].role }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.json({ token, user: newUser.rows[0] });

  } catch (err) {
    console.error("❌ Registration Error:", err.message);
    res.status(500).json({ error: 'Server error during registration' });
  }
};

// --- LOGIN USER ---
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Find user by email
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // 2. Check password
    const isMatch = await bcrypt.compare(password, user.rows[0].password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // 3. Send Token
    const token = jwt.sign(
      { id: user.rows[0].id, role: user.rows[0].role }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.json({ token, user: user.rows[0] });

  } catch (err) {
    console.error("❌ Login Error:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
};