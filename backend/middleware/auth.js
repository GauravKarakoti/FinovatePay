const jwt = require('jsonwebtoken');
const  { pool }  = require('../config/database');

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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id || decoded.userId;

    const userResult = await pool.query(
      'SELECT id, email, wallet_address, role, organization_id FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(403).json({ error: 'User not found' });
    }
    
    // 4. Attach user to the request object
    req.user = userResult.rows[0];

    next();

  } catch (error) {
    console.error("Auth Middleware Error:", error.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    // Determine the allowed roles
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    // Ensure req.user exists before checking role
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Requires one of: ${allowedRoles.join(', ')}` });
    }
    next();
  };
};

module.exports = {
  authenticateToken,
  requireRole
};
