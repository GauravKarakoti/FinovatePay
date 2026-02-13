const jwt = require('jsonwebtoken');
const  pool  = require('../config/database'); // ✅ Correct Import

const authenticateToken = async (req, res, next) => {
  // 1. Get the token from cookies first, then fall back to Authorization header
  let token = req.cookies?.token;
  
  if (!token) {
    // Fallback to Authorization header for backward compatibility
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }


  try {
    // 2. Verify Token (Using the correct environment variable)
    // We use ACCESS_TOKEN_SECRET to match your authController
    const secret = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);

    // 3. Find the User
    // IMPORTANT: We query by 'wallet_address' because that is what is inside the token
    const query = 'SELECT * FROM users WHERE wallet_address = $1';
    const { rows } = await pool.query(query, [decoded.wallet_address]);
    
    if (rows.length === 0) {
      return res.status(403).json({ error: 'User not found' });
    }
    
    // 4. Attach user to the request object
    req.user = rows[0];
    next();

  } catch (error) {
    console.error("Auth Middleware Error:", error.message);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

const requireRole = (role) => {
  return (req, res, next) => {
    // Ensure req.user exists before checking role
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: `Requires ${role} role` });
    }
    next();
  };
};

module.exports = {
  authenticateToken,
  requireRole
};
