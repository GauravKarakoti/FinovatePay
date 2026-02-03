const { pool } = require('../config/database');

class Invoice {
  static async create(invoiceData) {
    const {
      invoiceId,
      invoiceHash,
      sellerAddress,
      buyerAddress,
      amount,
      currency,
      dueDate,
      description,
      items,
      lot_id // <-- Added lot_id
    } = invoiceData;

    // Default financing status to 'none'
    const financing_status = invoiceData.financing_status || 'none';

    const query = `
      INSERT INTO invoices (
        invoice_id, invoice_hash, seller_address, buyer_address, 
        amount, currency, due_date, description, items, lot_id,
        financing_status
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const values = [
      invoiceId,
      invoiceHash,
      sellerAddress,
      buyerAddress,
      amount,
      currency,
      dueDate,
      description,
      JSON.stringify(items),
      lot_id, // <-- Added lot_id
      financing_status // <-- Added financing_status
    ];

    const result = await pool.query(query, values);

    return result.rows[0];
  }
  
  static async updateTokenizationStatus(invoiceId, tokenId, financingStatus) {
    const query = `
      UPDATE invoices
      SET
        is_tokenized = TRUE,
        token_id = $1,
        financing_status = $2, -- $2 is used for the enum column
        remaining_supply = CASE
          -- $4 is used for the text comparison
          WHEN $4 = 'listed' THEN amount
          ELSE remaining_supply
        END
      WHERE invoice_id = $3
      RETURNING *
    `;
    
    // Pass the financingStatus variable twice
    const result = await pool.query(query, [
      tokenId,
      financingStatus, // $2
      invoiceId,       // $3
      financingStatus  // $4
    ]);
    
    return result.rows[0];
  }
  // --- NEW METHOD ---
  // Method to decrement supply after an investment
  static async decrementRemainingSupply(invoiceId, amountInvested) {
    try {
      const query = `
        UPDATE invoices
        SET remaining_supply = remaining_supply - $1
        WHERE invoice_id = $2
        RETURNING remaining_supply
      `;
      // Ensure amountInvested is treated as a number
      const result = await pool.query(query, [parseFloat(amountInvested), invoiceId]);
      return result.rows[0]?.remaining_supply;
    } catch (error) {
      console.error("Error decrementing remaining supply:", error);
      throw error;
    }
  }

  static async findByPk(id) {
    const query = 'SELECT * FROM invoices WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  static async findBySeller(sellerAddress) {
    const query = 'SELECT * FROM invoices WHERE seller_address = $1 ORDER BY created_at DESC';
    const result = await pool.query(query, [sellerAddress]);
    return result.rows;
  }

  static async findByBuyer(buyerAddress) {
    const query = 'SELECT * FROM invoices WHERE buyer_address = $1 ORDER BY created_at DESC';
    const result = await pool.query(query, [buyerAddress]);
    return result.rows;
  }

  static async findById(invoiceId) {
    const query = 'SELECT * FROM invoices WHERE invoice_id = $1';
    const result = await pool.query(query, [invoiceId]);
    return result.rows[0];
  }

  static async updateStatus(invoiceId, status) {
    const query = 'UPDATE invoices SET status = $1 WHERE invoice_id = $2 RETURNING *';
    const result = await pool.query(query, [status, invoiceId]);
    return result.rows[0];
  }

  static async updateEscrowStatus(invoiceId, escrowStatus, txHash = null) {
    const query = `
      UPDATE invoices 
      SET escrow_status = $1, escrow_tx_hash = COALESCE($2, escrow_tx_hash) 
      WHERE invoice_id = $3 
      RETURNING *
    `;
    const result = await pool.query(query, [escrowStatus, txHash, invoiceId]);
    return result.rows[0];
  }
}

module.exports = Invoice;