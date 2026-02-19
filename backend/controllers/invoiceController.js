const { pool } = require('../config/database');

/*//////////////////////////////////////////////////////////////
                    CREATE INVOICE (FROM QUOTATION)
//////////////////////////////////////////////////////////////*/
exports.createInvoice = async (req, res) => {
    const client = await pool.connect();

    try {
        const {
            quotation_id,
            // On-chain data is still passed from the frontend after contract creation
            invoice_id,
            invoice_hash,
            contract_address,
            token_address,
            due_date,
            tx_hash, // <-- Added tx_hash
            discount_rate,
            discount_deadline
        } = req.body;

        if (!quotation_id || !invoice_id || !contract_address) {
            return res.status(400).json({ error: 'Missing quotation_id or required on-chain data.' });
        }

  try {
    const {
      quotation_id,
      invoice_id,
      invoice_hash,
      contract_address,
      token_address,
      due_date,
      tx_hash,
      annual_apr = 18.0
    } = req.body;

    if (!quotation_id || !invoice_id || !contract_address) {
      return res.status(400).json({
        error: 'Missing quotation_id, invoice_id, or contract_address'
      });
    }

        if (quotationResult.rows.length === 0) {
            throw new Error('Quotation not found, not fully approved, or already invoiced.');
        }
        
        // FIX: Add Quantity Validation
        if (!quotation.quantity || quotation.quantity <= 0) {
             await client.query('ROLLBACK');
             return res.status(400).json({ error: "Invalid quantity in quotation" });
        }

        // TWEAK: RBAC - Check Organization ID instead of Wallet Address
        // This allows any authorized user in the company to process the invoice
        if (quotation.seller_org_id !== req.user.organization_id) {
            throw new Error('Not authorized: Quotation belongs to a different organization.');
        }
    await client.query('BEGIN');

    // 1. Lock & validate quotation
    const quotationQuery = `
      SELECT * FROM quotations 
      WHERE id = $1 AND status = 'approved'
      FOR UPDATE
    `;
    const quotationResult = await client.query(quotationQuery, [quotation_id]);

    if (quotationResult.rows.length === 0) {
      throw new Error('Quotation not found, not approved, or already invoiced');
    }

    const quotation = quotationResult.rows[0];

    // RBAC: org-level authorization
    if (quotation.seller_org_id !== req.user.organization_id) {
      throw new Error('Not authorized for this quotation');
    }

    // 2. Handle produce inventory if applicable
    if (quotation.lot_id) {
      const lotQuery = `
        SELECT current_quantity 
        FROM produce_lots 
        WHERE lot_id = $1
        FOR UPDATE
      `;
      const lotResult = await client.query(lotQuery, [quotation.lot_id]);

      if (lotResult.rows.length === 0) {
        throw new Error('Produce lot not found');
      }

      const lot = lotResult.rows[0];

      if (Number(lot.current_quantity) < Number(quotation.quantity)) {
        throw new Error(
          `Insufficient quantity. Only ${lot.current_quantity} available`
        );
      }

      await client.query(
        `UPDATE produce_lots 
         SET current_quantity = current_quantity - $1 
         WHERE lot_id = $2`,
        [quotation.quantity, quotation.lot_id]
      );
    }

    // 4. Mark quotation as invoiced
    await client.query(
      `UPDATE quotations SET status = 'invoiced' WHERE id = $1`,
      [quotation_id]
    );

    await client.query('COMMIT');

        const insertInvoiceQuery = `
            INSERT INTO invoices (
                invoice_id, invoice_hash, seller_address, buyer_address,
                amount, due_date, description, items, currency,
                contract_address, token_address, lot_id, quotation_id, escrow_status,
                financing_status, tx_hash,
                discount_rate, discount_deadline
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'created', 'none', $14, $15, $16)
            RETURNING *
        `;
        const values = [
            invoice_id, invoice_hash, quotation.seller_address, quotation.buyer_address,
            quotation.total_amount, due_date, quotation.description,
            JSON.stringify([{
                description: quotation.description,
                quantity: quotation.quantity,
                // Use env variable or fallback
                price_per_unit: quotation.price_per_unit / (parseFloat(process.env.EXCHANGE_RATE) || 50.75)
            }]),
            quotation.currency, contract_address, token_address,
            quotation.lot_id, quotation_id, tx_hash || null,
            discount_rate || 0,
            discount_deadline || 0
        ];

        const result = await client.query(insertInvoiceQuery, values);

        // 4. Update the quotation status to 'invoiced' to prevent reuse
        const updateQuotationQuery = `UPDATE quotations SET status = 'invoiced' WHERE id = $1`;
        await client.query(updateQuotationQuery, [quotation_id]);

        await client.query('COMMIT');
        res.status(201).json({ success: true, invoice: result.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating invoice from quotation:', error);
        // In production, avoid leaking internal error details
        const errorMessage = process.env.NODE_ENV === 'development' ? error.message : 'Internal server error.';
        res.status(500).json({ error: errorMessage });
    } finally {
        client.release();
    }
  } catch (error) {
    console.error('Early payment offer error:', error);
    res.status(500).json({ error: error.message });
  }
};

/*//////////////////////////////////////////////////////////////
                ACCEPT EARLY PAYMENT OFFER
//////////////////////////////////////////////////////////////*/
exports.settleInvoiceEarly = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const result = await pool.query(
      `
      UPDATE invoices
      SET status = 'paid',
          financing_status = 'early_paid',
          settled_at = NOW()
      WHERE invoice_id = $1
      RETURNING *
      `,
      [invoiceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({
      success: true,
      message: 'Invoice settled early',
      invoice: result.rows[0]
    });

  } catch (error) {
    console.error('Settle invoice error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getEarlyPaymentOffer = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    // You need to fetch the invoice from the DB first
    const result = await pool.query(
      'SELECT amount, annual_apr, due_date FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = result.rows[0];
    const amount = Number(invoice.amount);
    // Provide a fallback APR if it's null in the DB
    const apr = Number(invoice.annual_apr || 18.0) / 100; 

    const today = new Date();
    const dueDate = new Date(invoice.due_date);
    const daysRemaining = Math.ceil(
      (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysRemaining <= 0) {
      return res.json({
        eligible: false,
        message: 'Invoice is due or overdue'
      });
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
    console.error('Early payment offer error:', error);
    res.status(500).json({ error: error.message });
  }
};