const pool = require('../config/database');

const requireKYC = async (req, res, next) => {
  try {
    const userResult = await pool.query(
      'SELECT kyc_status FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (userResult.rows.length === 0 || userResult.rows[0].kyc_status !== 'verified') {
      return res.status(403).json({ 
        error: 'KYC verification required for this operation' 
      });
    }
    
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  requireKYC
};