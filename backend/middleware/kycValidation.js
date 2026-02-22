const { pool } = require('../config/database'); // Ensure correct destructuring

const requireKYC = async (req, res, next) => {
  try {
    // 1. Check if user is logged in (handled by auth middleware)
    if (!req.user || !req.user.wallet_address) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // 2. Query by Wallet Address (Safe & Consistent)
    const query = 'SELECT kyc_status FROM users WHERE wallet_address = $1';
    const result = await pool.query(query, [req.user.wallet_address]);
    
    // 3. Check Status
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User record not found' });
    }

    if (result.rows[0].kyc_status !== 'verified') {
      return res.status(403).json({ 
        error: 'KYC verification required for this operation' 
      });
    }
    
    next();
  } catch (error) {
    console.error("KYC Middleware Error:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = {
  requireKYC
};