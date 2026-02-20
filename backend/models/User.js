const pool  = require('../config/database');

class User {
  static async create(userData) {
    const {
      email, passwordHash, walletAddress, companyName, 
      taxId, firstName, lastName, role, organizationId // TWEAK: Added organizationId
    } = userData;

    const query = `
      INSERT INTO users (
        email, password_hash, wallet_address, company_name, 
        tax_id, first_name, last_name, role, organization_id
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'seller'), $9)
      RETURNING id, email, wallet_address, company_name, role, organization_id, created_at
    `;

    const values = [
      email, passwordHash, walletAddress, companyName,
      taxId, firstName, lastName, role, organizationId
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async findByEmail(email) {
    const query = `
      SELECT id, email, wallet_address, company_name, 
             first_name, last_name, role, created_at 
      FROM users WHERE email = $1
    `;
    const result = await pool.query(query, [email]);
    return result.rows[0];
  }

  static async findByWalletAddress(walletAddress) {
    const query = `
      SELECT id, email, wallet_address, company_name, 
             first_name, last_name, role, created_at 
      FROM users WHERE wallet_address = $1
    `;
    const result = await pool.query(query, [walletAddress]);
    return result.rows[0];
  }

  // Helper method to get user with password for authentication
  static async findByEmailWithPassword(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await pool.query(query, [email]);
    return result.rows[0];
  }

  static async findById(id) {
    // TWEAK: Return organization_id
    const query = 'SELECT id, email, wallet_address, company_name, kyc_status, role, organization_id FROM users WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0];
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