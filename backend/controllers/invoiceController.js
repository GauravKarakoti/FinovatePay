const  pool  = require('../config/database');

// 1. Create a New Invoice
const createInvoice = async (req, res) => {
  try {
    const { client, amount, due_date, seller_address } = req.body;

    // Default APR is 18% if not provided
    const annual_apr = req.body.annual_apr || 18.00;

    const query = `
      INSERT INTO invoices 
      (client, amount, due_date, seller_address, status, annual_apr, financing_status) 
      VALUES ($1, $2, $3, $4, 'pending', $5, 'none') 
      RETURNING *
    `;
    
    const values = [client, amount, due_date, seller_address, annual_apr];
    const result = await pool.query(query, values);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating invoice:", error);
    res.status(500).json({ error: error.message });
  }
};

// 2. Get Early Payment Offer (The "Get Paid Early" Logic)
const getEarlyPaymentOffer = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    // Fetch the invoice
    const result = await pool.query('SELECT * FROM invoices WHERE invoice_id = $1', [invoiceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const invoice = result.rows[0];

    // Calculate Discount
    // Formula: (Amount * APR * DaysRemaining) / 365
    const amount = parseFloat(invoice.amount.replace(/[^0-9.-]+/g, "")); // Remove '$' or 'USDC'
    const apr = parseFloat(invoice.annual_apr) / 100;
    
    const today = new Date();
    const dueDate = new Date(invoice.due_date);
    const timeDiff = dueDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

    // If invoice is overdue or due today, no discount possible
    if (daysRemaining <= 0) {
      return res.json({ eligible: false, message: "Invoice is due or overdue" });
    }

    const discountAmount = (amount * apr * daysRemaining) / 365;
    const offerAmount = amount - discountAmount;

    res.json({
      eligible: true,
      originalAmount: amount,
      discountAmount: discountAmount.toFixed(2),
      offerAmount: offerAmount.toFixed(2),
      daysRemaining,
      apr: (apr * 100).toFixed(2)
    });

  } catch (error) {
    console.error("Error generating offer:", error);
    res.status(500).json({ error: error.message });
  }
};

// 3. Settle Invoice Early (Accept the offer)
const settleInvoiceEarly = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    // In a real app, this is where you would trigger the Blockchain Transaction.
    // For now, we update the database to reflect the settlement.

    const query = `
      UPDATE invoices 
      SET status = 'paid', 
          financing_status = 'early_paid', 
          settled_at = NOW() 
      WHERE invoice_id = $1 
      RETURNING *
    `;

    const result = await pool.query(query, [invoiceId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    res.json({ success: true, message: "Invoice settled early!", invoice: result.rows[0] });

  } catch (error) {
    console.error("Error settling invoice:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createInvoice,
  getEarlyPaymentOffer,
  settleInvoiceEarly
};