const jwt = require('jsonwebtoken');
const  pool  = require('../config/database'); // ✅ Correct Import

const authenticateToken = async (req, res, next) => {
  // 1. Get the token from the header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userResult = await pool.query(
      'SELECT id, email, wallet_address, role, organization_id FROM users WHERE id = $1',
      [decoded.userId]
    );
    
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