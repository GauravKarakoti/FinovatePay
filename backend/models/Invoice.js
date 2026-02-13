const  pool  = require('../config/database');

class Invoice {
  // Find all invoices for a specific seller
  static async findBySeller(address) {
    try {
      const query = 'SELECT * FROM invoices WHERE seller_address = $1 ORDER BY created_at DESC';
      const { rows } = await pool.query(query, [address]);
      return rows;
    } catch (error) {
      throw error;
    }
  }

  // Find all invoices for a specific buyer
  static async findByBuyer(address) {
    try {
      const query = 'SELECT * FROM invoices WHERE buyer_address = $1 ORDER BY created_at DESC';
      const { rows } = await pool.query(query, [address]);
      return rows;
    } catch (error) {
      throw error;
    }
  }

  // Find a single invoice by ID
  static async findById(id) {
    try {
      const query = 'SELECT * FROM invoices WHERE invoice_id = $1';
      const { rows } = await pool.query(query, [id]);
      return rows[0];
    } catch (error) {
      throw error;
    }
  }

  // Create method (Optional, as Controller handles it, but good to have)
  static async create(data) {
    const { client, amount, due_date, seller_address } = data;
    const query = `
      INSERT INTO invoices (client, amount, due_date, seller_address, status)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING *
    `;
    const { rows } = await pool.query(query, [client, amount, due_date, seller_address]);
    return rows[0];
  }
}

module.exports = Invoice;