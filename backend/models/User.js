const pool = require('../config/database');

class User {
  static async create(userData) {
    const {
      email,
      passwordHash,
      walletAddress,
      companyName,
      taxId,
      firstName,
      lastName
    } = userData;

    const query = `
      INSERT INTO users (
        email, password_hash, wallet_address, company_name, 
        tax_id, first_name, last_name
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, email, wallet_address, company_name, created_at
    `;

    const values = [
      email,
      passwordHash,
      walletAddress,
      companyName,
      taxId,
      firstName,
      lastName
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await pool.query(query, [email]);
    return result.rows[0];
  }

  static async findByWalletAddress(walletAddress) {
    const query = 'SELECT * FROM users WHERE wallet_address = $1';
    const result = await pool.query(query, [walletAddress]);
    return result.rows[0];
  }

  static async findById(id) {
    const query = 'SELECT id, email, wallet_address, company_name, kyc_status, role FROM users WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  static async updateKYCStatus(userId, status, riskLevel, details = null) {
    const query = `
      UPDATE users 
      SET kyc_status = $1, kyc_risk_level = $2, kyc_details = $3 
      WHERE id = $4 
      RETURNING id, email, wallet_address, kyc_status, kyc_risk_level
    `;
    const result = await pool.query(query, [status, riskLevel, details, userId]);
    return result.rows[0];
  }

  static async updateRole(userId, role) {
    const query = 'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role';
    const result = await pool.query(query, [role, userId]);
    return result.rows[0];
  }
}

module.exports = User;