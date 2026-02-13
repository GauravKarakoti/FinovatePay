const pool  = require('../config/database');

class User {
  // Find user by Wallet Address
  static async findByWalletAddress(walletAddress) {
    try {
      const query = 'SELECT * FROM users WHERE wallet_address = $1';
      const { rows } = await pool.query(query, [walletAddress]);
      return rows[0];
    } catch (error) {
      throw error;
    }
  }

  // Create new User
  static async create(userData) {
    const { wallet_address, role, name, email } = userData;
    try {
      const query = `
        INSERT INTO users (wallet_address, role, name, email)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;
      const { rows } = await pool.query(query, [wallet_address, role, name, email]);
      return rows[0];
    } catch (error) {
      throw error;
    }
  }
  
  // Update KYC Status
  static async updateKYCStatus(walletAddress, status) {
    try {
      const query = `
        UPDATE users SET kyc_status = $1 WHERE wallet_address = $2 RETURNING *
      `;
      const { rows } = await pool.query(query, [status, walletAddress]);
      return rows[0];
    } catch (error) {
      throw error;
    }
  }
}

module.exports = User;