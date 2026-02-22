const { pool } = require('../config/database');

/*//////////////////////////////////////////////////////////////
                CREATE INVOICE (FROM QUOTATION)
//////////////////////////////////////////////////////////////*/
exports.createInvoice = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      quotation_id,
      invoice_id,
      invoice_hash,
      contract_address,
      token_address,
      due_date,
      tx_hash,
      discount_rate = 0,
      discount_deadline = null,
      annual_apr = 18.0
    } = req.body;

    /*----------------------------------------------------------
      Basic validation
    ----------------------------------------------------------*/
    if (!quotation_id || !invoice_id || !contract_address) {
      return res.status(400).json({
        error: 'Missing quotation_id, invoice_id, or contract_address'
      });
    }

    await client.query('BEGIN');

    /*----------------------------------------------------------
      1. Fetch & lock approved quotation
    ----------------------------------------------------------*/
    const quotationResult = await client.query(
      `SELECT * FROM quotations
       WHERE id = $1 AND status = 'approved'
       FOR UPDATE`,
      [quotation_id]
    );

    if (quotationResult.rows.length === 0) {
      throw new Error('Quotation not found, not approved, or already invoiced');
    }

    const quotation = quotationResult.rows[0];

    /*----------------------------------------------------------
      2. RBAC check
    ----------------------------------------------------------*/
    if (quotation.seller_org_id !== req.user.organization_id) {
      throw new Error('Not authorized for this quotation');
    }

    /*----------------------------------------------------------
      3. Quantity validation
    ----------------------------------------------------------*/
    if (!quotation.quantity || quotation.quantity <= 0) {
      throw new Error('Invalid quantity in quotation');
    }

    /*----------------------------------------------------------
      4. Inventory handling (produce lots)
    ----------------------------------------------------------*/
    if (quotation.lot_id) {
      const lotResult = await client.query(
        `SELECT current_quantity
         FROM produce_lots
         WHERE lot_id = $1
         FOR UPDATE`,
        [quotation.lot_id]
      );

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

    /*----------------------------------------------------------
      5. Insert invoice
    ----------------------------------------------------------*/
    const insertResult = await client.query(
      `INSERT INTO invoices (
        invoice_id,
        invoice_hash,
        seller_address,
        buyer_address,
        amount,
        due_date,
        description,
        items,
        currency,
        contract_address,
        token_address,
        lot_id,
        quotation_id,
        escrow_status,
        financing_status,
        tx_hash,
        discount_rate,
        discount_deadline,
        annual_apr
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        $10,$11,$12,$13,
        'created','none',
        $14,$15,$16,$17
      )
      RETURNING *`,
      [
        invoice_id,
        invoice_hash,
        quotation.seller_address,
        quotation.buyer_address,
        quotation.total_amount,
        due_date,
        quotation.description,
        JSON.stringify([
          {
            description: quotation.description,
            quantity: quotation.quantity,
            price_per_unit: quotation.price_per_unit
          }
        ]),
        quotation.currency,
        contract_address,
        token_address,
        quotation.lot_id,
        quotation_id,
        tx_hash || null,
        discount_rate,
        discount_deadline,
        annual_apr
      ]
    );

    /*----------------------------------------------------------
      6. Mark quotation invoiced
    ----------------------------------------------------------*/
    await client.query(
      `UPDATE quotations SET status = 'invoiced' WHERE id = $1`,
      [quotation_id]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      invoice: insertResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create invoice error:', error);

    let statusCode = 500;
    if (error.message.includes('not found')) statusCode = 404;
    if (error.message.includes('Not authorized')) statusCode = 403;
    if (error.message.includes('Insufficient quantity')) statusCode = 400;

    return res.status(statusCode).json({
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error'
    });

  } finally {
    client.release();
  }
};

/*//////////////////////////////////////////////////////////////
                GET EARLY PAYMENT OFFER
//////////////////////////////////////////////////////////////*/
exports.getEarlyPaymentOffer = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const result = await pool.query(
      'SELECT amount, annual_apr, due_date FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = result.rows[0];
    const amount = Number(invoice.amount);
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

    return res.json({
      eligible: true,
      originalAmount: amount,
      discountAmount: discountAmount.toFixed(2),
      offerAmount: offerAmount.toFixed(2),
      daysRemaining,
      apr: (apr * 100).toFixed(2)
    });

  } catch (error) {
    console.error('Early payment offer error:', error);
    return res.status(500).json({ error: error.message });
  }
};

/*//////////////////////////////////////////////////////////////
                SETTLE INVOICE EARLY
//////////////////////////////////////////////////////////////*/
exports.settleInvoiceEarly = async (req, res) => {
  const client = await pool.connect();

  try {
    const { invoiceId } = req.params;
    const { tx_hash } = req.body;

    await client.query('BEGIN');

    /*----------------------------------------------------------
      1. Fetch & lock the invoice
    ----------------------------------------------------------*/
    const result = await client.query(
      `SELECT * FROM invoices 
       WHERE invoice_id = $1 
       FOR UPDATE`,
      [invoiceId]
    );

    if (result.rows.length === 0) {
      throw new Error('Invoice not found');
    }

    const invoice = result.rows[0];

    /*----------------------------------------------------------
      2. Authorization & Status Check
    ----------------------------------------------------------*/
    if (req.user.role === 'buyer' && invoice.buyer_address !== req.user.wallet_address) {
      throw new Error('Not authorized to settle this invoice');
    }

    if (['settled', 'paid', 'completed'].includes(invoice.escrow_status)) {
      throw new Error('Invoice is already settled or paid');
    }

    /*----------------------------------------------------------
      3. Eligibility Check & Calculations
    ----------------------------------------------------------*/
    const today = new Date();
    const dueDate = new Date(invoice.due_date);
    const daysRemaining = Math.ceil(
      (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysRemaining <= 0) {
      throw new Error('Invoice is due or overdue, cannot settle early');
    }

    const amount = Number(invoice.amount);
    const apr = Number(invoice.annual_apr || 18.0) / 100;
    const discountAmount = (amount * apr * daysRemaining) / 365;
    const offerAmount = amount - discountAmount;

    /*----------------------------------------------------------
      4. Update Invoice Status
    ----------------------------------------------------------*/
    const updateResult = await client.query(
      `UPDATE invoices 
       SET escrow_status = 'settled', 
           tx_hash = COALESCE($1, tx_hash) 
       WHERE invoice_id = $2 
       RETURNING *`,
      [tx_hash || null, invoiceId]
    );

    await client.query('COMMIT');

    return res.status(200).json({ 
      success: true, 
      message: 'Invoice settled early successfully',
      settledAmount: offerAmount.toFixed(2),
      discountApplied: discountAmount.toFixed(2),
      invoice: updateResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Early settlement error:', error);
    
    let statusCode = 500;
    if (error.message.includes('not found')) statusCode = 404;
    if (error.message.includes('Not authorized')) statusCode = 403;
    if (error.message.includes('overdue') || error.message.includes('already settled')) statusCode = 400;

    return res.status(statusCode).json({ error: error.message });
  } finally {
    client.release();
  }
};