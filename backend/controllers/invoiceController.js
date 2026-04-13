const { pool } = require('../config/database');
const { errorResponse } = require('../utils/errorResponse');
const logger = require('../utils/logger')('invoiceController');

const MIN_AMOUNT = 0.01;
const MAX_AMOUNT = 1000000000; // 1 billion
const REQUIRED_FIELDS = ['quotation_id', 'invoice_id', 'contract_address'];

/*//////////////////////////////////////////////////////////////
                CREATE INVOICE (FROM QUOTATION)
//////////////////////////////////////////////////////////////*/
exports.createInvoice = async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const {
            quotation_id,
            invoice_id,
            invoice_hash,
            contract_address,
            token_address,
            due_date,
            discount_rate,     // <-- ADD THIS
            discount_deadline  // <-- ADD THIS
        } = req.body;

        logger.info('Creating invoice', { quotation_id, invoice_id });

        // Validate required fields
        const missingFields = REQUIRED_FIELDS.filter(field => !req.body[field]);
        if (missingFields.length > 0) {
            logger.warn('Missing required fields for invoice creation', { missingFields });
            return errorResponse(res, `Missing required fields: ${missingFields.join(', ')}`, 400);
        }

        // Validate field types
        if (typeof quotation_id !== 'string' || typeof invoice_id !== 'string') {
            logger.warn('Invalid field types for invoice creation');
            return errorResponse(res, 'quotation_id and invoice_id must be strings', 400);
        }

        if (!contract_address || !/^0x[a-fA-F0-9]{40}$/.test(contract_address)) {
            logger.warn('Invalid contract address', { contract_address });
            return errorResponse(res, 'Invalid contract_address format (must be valid Ethereum address)', 400);
        }

        if (token_address && !/^0x[a-fA-F0-9]{40}$/.test(token_address)) {
            logger.warn('Invalid token address', { token_address });
            return errorResponse(res, 'Invalid token_address format (must be valid Ethereum address)', 400);
        }

        // 1. Fetch and lock the quotation
        const quotationQuery = `SELECT * FROM quotations WHERE id = $1 FOR UPDATE`;
        const quotationResult = await client.query(quotationQuery, [quotation_id]);

        if (!quotationResult.rows || quotationResult.rows.length === 0) {
            logger.warn('Quotation not found', { quotation_id });
            return errorResponse(res, `Quotation with ID ${quotation_id} not found`, 404);
        }
        
        const quotation = quotationResult.rows[0];

        // 2. Status Validation
        if (!quotation.status) {
            logger.error('Quotation missing status field', { quotation_id });
            throw new Error('Invalid quotation state: missing status field');
        }

        if (quotation.status === 'invoiced') {
            logger.warn('Quotation already invoiced', { quotation_id });
            return errorResponse(res, 'Quotation already invoiced', 400);
        }
        
        if (quotation.status !== 'approved') {
            logger.warn('Quotation not approved', { quotation_id, status: quotation.status });
            return errorResponse(res, `Quotation status must be 'approved', currently: ${quotation.status}`, 400);
        }

        // 3. RBAC / Authorization Check
        if (!req.user) {
            logger.error('User missing from request');
            return errorResponse(res, 'User authentication required', 401);
        }

        const isWalletMatch = quotation.seller_address && req.user.wallet_address && 
            (quotation.seller_address.toLowerCase() === req.user.wallet_address.toLowerCase());
            
        const isOrgMatch = quotation.seller_org_id && req.user.organization_id && 
            (quotation.seller_org_id === req.user.organization_id);

        if (!isWalletMatch && !isOrgMatch) {
            logger.warn('Authorization failed for quotation', { 
                quotation_id, 
                userId: req.user.id,
                quotation_seller: quotation.seller_address,
                user_wallet: req.user.wallet_address
            });
            return errorResponse(res, 'Not authorized: You do not own this quotation', 403);
        }

        // 4. Quantity Validation
        if (!quotation.quantity || Number(quotation.quantity) <= 0) {
             logger.warn('Invalid quantity in quotation', { quotation_id, quantity: quotation.quantity });
             return errorResponse(res, `Invalid quantity in quotation: ${quotation.quantity} (must be positive)`, 400);
        }

        // 5. Amount Validation
        const amount = Number(quotation.total_amount || 0);
        if (isNaN(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
            logger.warn('Invalid amount in quotation', { quotation_id, amount });
            return errorResponse(res, `Invalid amount: ${amount} (must be between ${MIN_AMOUNT} and ${MAX_AMOUNT})`, 400);
        }

        // 5. Amount Validation
        if (!quotation.total_amount || parseFloat(quotation.total_amount) <= 0) {
            throw new Error("Invalid amount: Invoice amount must be greater than zero");
        }

        // Additional validation for price_per_unit
        if (!quotation.price_per_unit || parseFloat(quotation.price_per_unit) <= 0) {
            throw new Error("Invalid price: Price per unit must be greater than zero");
        }

        // 6. Inventory Management (Produce Lots)
        if (quotation.lot_id) {
            const lotQuery = 'SELECT current_quantity FROM produce_lots WHERE lot_id = $1 FOR UPDATE';
            const lotResult = await client.query(lotQuery, [quotation.lot_id]);

            if (!lotResult.rows || lotResult.rows.length === 0) {
                logger.warn('Produce lot not found', { lot_id: quotation.lot_id });
                return errorResponse(res, `Produce lot with ID ${quotation.lot_id} not found`, 404);
            }
            
            const lot = lotResult.rows[0];
            if (!lot.current_quantity) {
                logger.error('Lot missing current_quantity field', { lot_id: quotation.lot_id });
                throw new Error('Lot has invalid state: missing current_quantity');
            }

            if (parseFloat(lot.current_quantity) < parseFloat(quotation.quantity)) {
                logger.warn('Insufficient lot quantity', { lot_id: quotation.lot_id, available: lot.current_quantity, required: quotation.quantity });
                return errorResponse(res, `Insufficient quantity. Only ${lot.current_quantity}kg available.`, 400);
            }

            const updateLotQuery = 'UPDATE produce_lots SET current_quantity = current_quantity - $1 WHERE lot_id = $2';
            await client.query(updateLotQuery, [quotation.quantity, quotation.lot_id]);
        }

        const insertInvoiceQuery = `
            INSERT INTO invoices (
                invoice_id, invoice_hash, seller_address, buyer_address,
                amount, due_date, description, items, currency,
                contract_address, token_address, lot_id, quotation_id, escrow_status,
                financing_status, discount_rate, discount_deadline
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'created', 'none', $14, $15)
            RETURNING *
        `;

        // Validate seller and buyer addresses
        if (!quotation.seller_address || !/^0x[a-fA-F0-9]{40}$/.test(quotation.seller_address)) {
            logger.error('Invalid seller address in quotation', { quotation_id });
            throw new Error('Quotation has invalid seller_address');
        }

        if (!quotation.buyer_address || !/^0x[a-fA-F0-9]{40}$/.test(quotation.buyer_address)) {
            logger.error('Invalid buyer address in quotation', { quotation_id });
            throw new Error('Quotation has invalid buyer_address');
        }

        // Use env variable for exchange rate with strict validation
        const exchangeRateEnv = process.env.EXCHANGE_RATE;
        if (!exchangeRateEnv) {
            console.error('[CRITICAL] EXCHANGE_RATE environment variable is not set!');
            console.error('[CRITICAL] Using fallback rate of 50.75 - this may cause financially incorrect invoices!');
            // In production, consider throwing an error instead:
            // throw new Error('EXCHANGE_RATE environment variable is required for invoice creation');
        }
        const exchangeRate = parseFloat(exchangeRateEnv);
        if (exchangeRateEnv && (isNaN(exchangeRate) || exchangeRate <= 0)) {
            throw new Error('EXCHANGE_RATE environment variable must be a valid positive number');
        }
        const effectiveExchangeRate = exchangeRate || 50.75; // Fallback only with warning
        const pricePerUnit = quotation.price_per_unit / effectiveExchangeRate;

        const values = [
            invoice_id,
            invoice_hash,
            quotation.seller_address,
            quotation.buyer_address,
            quotation.total_amount,
            due_date,
            quotation.description,
            JSON.stringify([{
                description: quotation.description,
                quantity: quotation.quantity,
                price_per_unit: pricePerUnit
            }]),
            quotation.currency,
            contract_address,
            token_address,
            quotation.lot_id,
            quotation_id,
            discount_rate || null, // <-- ADD THIS
            discount_deadline ? new Date(discount_deadline * 1000).toISOString() : null
        ];

        const result = await client.query(insertInvoiceQuery, values);

        if (!result.rows || result.rows.length === 0) {
            logger.error('Failed to insert invoice', { invoice_id });
            throw new Error('Invoice insertion returned no rows');
        }

        // 8. Update Quotation Status
        const updateQuotationQuery = `UPDATE quotations SET status = 'invoiced' WHERE id = $1`;
        await client.query(updateQuotationQuery, [quotation_id]);

        await client.query('COMMIT');

        logger.info('Invoice created successfully', { invoice_id, quotation_id });

        return res.status(201).json({
            success: true,
            message: "Invoice created successfully",
            invoice: result.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK').catch(rollbackErr => {
            logger.error('Rollback failed during invoice creation', { error: rollbackErr.message });
        });
        
        logger.error('Error creating invoice from quotation', { 
            error: error.message, 
            quotation_id: req.body?.quotation_id,
            stack: error.stack 
        });

        // Determine status code based on error message
        let statusCode = 500;
        if (error.message === 'Quotation not found') statusCode = 404;
        if (error.message === 'Quotation already invoiced') statusCode = 400;
        if (error.message === 'Quotation not fully approved') statusCode = 400;
        if (error.message.includes('Not authorized')) statusCode = 403;
        if (error.message.includes('Insufficient quantity')) statusCode = 400;
        if (error.message.includes('already invoiced') || error.message.includes('not approved')) statusCode = 400;
        if (error.message.includes('Invalid amount')) statusCode = 400;
        if (error.message.includes('Invalid price')) statusCode = 400;
        if (error.message === 'Missing quotation_id or required on-chain data.') statusCode = 400;

        return errorResponse(res, error, statusCode);
    } finally {
        client.release();
    }
};

exports.getEarlyPaymentOffer = async (req, res) => {
  try {
    const { invoiceId } = req.params;

    if (!invoiceId || typeof invoiceId !== 'string') {
      return errorResponse(res, 'Invalid invoiceId', 400);
    }

    // FIX 1: Add discount_rate and discount_deadline to the SELECT query
    const result = await pool.query(
      'SELECT amount, annual_apr, due_date, escrow_status, discount_rate, discount_deadline FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (!result.rows || result.rows.length === 0) {
      return errorResponse(res, `Invoice with ID ${invoiceId} not found`, 404);
    }

    const invoice = result.rows[0];
    const today = new Date();
    const dueDate = new Date(invoice.due_date);

    // FIX 2: Use the custom seller deadline if it exists
    let expirationDate = dueDate;
    if (invoice.discount_deadline) {
        expirationDate = new Date(invoice.discount_deadline);
    }

    // Expiration check against the custom timer
    if (expirationDate.getTime() < today.getTime()) {
      return res.json({
        eligible: false,
        message: 'Discount offer has expired',
        invoiceId
      });
    }

    const daysRemaining = Math.ceil(
      (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysRemaining <= 0) {
      return res.json({
        eligible: false,
        message: `Invoice is ${daysRemaining === 0 ? 'due today' : 'overdue'}`,
        invoiceId
      });
    }

    const amount = Number(invoice.amount);
    const apr = Number(invoice.annual_apr || 18.0) / 100;

    // FIX 3: Calculate using custom BPS rate if set, otherwise fallback to APR calculation
    let discountAmount = 0;
    let finalApr = apr * 100;

    if (invoice.discount_rate) {
        const customRateDecimal = Number(invoice.discount_rate) / 10000;
        discountAmount = amount * customRateDecimal;
        finalApr = customRateDecimal * 100;
    } else {
        discountAmount = (amount * apr * daysRemaining) / 365;
    }

    const offerAmount = amount - discountAmount;

    // FIX 4: Ensure keys match what EarlyPaymentCard.jsx expects (finalAmount, daysEarly)
    return res.json({
      eligible: true,
      invoiceId,
      originalAmount: amount.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      finalAmount: offerAmount.toFixed(2), 
      daysEarly: daysRemaining,            
      apr: finalApr.toFixed(2),
      offerExpiresAt: expirationDate.toISOString() 
    });

  } catch (error) {
    logger.error('Error calculating early payment offer', { error: error.message, invoiceId: req.params?.invoiceId });
    return errorResponse(res, `Calculation failed: ${error.message}`, 500);
  }
};

exports.settleInvoiceEarly = async (req, res) => {
  const client = await pool.connect();

  try {
    const { invoiceId } = req.params;
    const { tx_hash } = req.body;

    // Input validation
    if (!invoiceId || typeof invoiceId !== 'string') {
      logger.warn('settleInvoiceEarly called with invalid invoiceId', { invoiceId });
      return errorResponse(res, 'Invalid invoiceId: Must be a non-empty string', 400);
    }

    if (!req.user || !req.user.id) {
      logger.error('settleInvoiceEarly called without authenticated user');
      return errorResponse(res, 'User authentication required', 401);
    }

    // Validate tx_hash if provided
    if (tx_hash && !/^0x[a-fA-F0-9]{64}$/.test(tx_hash)) {
      logger.warn('Invalid transaction hash format', { tx_hash, invoiceId });
      return errorResponse(res, 'Invalid transaction hash format (must be valid Ethereum tx hash)', 400);
    }

    logger.info('Settling invoice early', { invoiceId, userId: req.user.id });

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

    if (!result.rows || result.rows.length === 0) {
      logger.warn('Invoice not found', { invoiceId });
      throw new Error(`Invoice with ID ${invoiceId} not found`);
    }

    const invoice = result.rows[0];

    // Validate required invoice fields
    if (!invoice.buyer_address || !invoice.seller_address) {
      logger.error('Invoice missing address fields', { invoiceId });
      throw new Error('Invalid invoice state: missing address fields');
    }

    if (invoice.amount === null || invoice.amount === undefined) {
      logger.error('Invoice missing amount', { invoiceId });
      throw new Error('Invalid invoice state: missing amount');
    }

    if (!invoice.due_date) {
      logger.error('Invoice missing due_date', { invoiceId });
      throw new Error('Invalid invoice state: missing due_date');
    }

    /*----------------------------------------------------------
      2. Authorization & Status Check
    ----------------------------------------------------------*/
    // Ensure the user owns this invoice (if they are a buyer)
    if (req.user.role === 'buyer' && invoice.buyer_address.toLowerCase() !== (req.user.wallet_address || '').toLowerCase()) {
      logger.warn('Authorization failed for early settlement', { invoiceId, userId: req.user.id });
      throw new Error('Not authorized: You can only settle invoices where you are the buyer');
    }

    // Ensure it's not already paid/settled
    if (['settled', 'paid', 'completed'].includes(invoice.escrow_status)) {
      logger.info('Invoice already settled', { invoiceId, status: invoice.escrow_status });
      throw new Error(`Invoice is already ${invoice.escrow_status}, cannot settle early`);
    }

    /*----------------------------------------------------------
      3. Eligibility Check & Calculations
    ----------------------------------------------------------*/
    const today = new Date();
    const dueDate = new Date(invoice.due_date);

    if (isNaN(dueDate.getTime())) {
      logger.error('Invalid due_date format', { invoiceId, due_date: invoice.due_date });
      throw new Error('Invalid invoice due date format');
    }

    const daysRemaining = Math.ceil(
      (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysRemaining <= 0) {
      logger.warn('Invoice is due or overdue', { invoiceId, daysRemaining });
      throw new Error(`Invoice is ${daysRemaining === 0 ? 'due today' : 'overdue'}, cannot settle early`);
    }

    // Calculate the final amounts for the response
    const amount = Number(invoice.amount);
    if (isNaN(amount) || amount <= 0) {
      logger.error('Invalid invoice amount', { invoiceId, amount });
      throw new Error('Invalid invoice amount');
    }

    const apr = Number(invoice.annual_apr || 18.0) / 100;
    if (apr < 0) {
      logger.error('Invalid APR value', { invoiceId, apr: invoice.annual_apr });
      throw new Error('Invalid APR value');
    }

    const discountAmount = (amount * apr * daysRemaining) / 365;
    const offerAmount = amount - discountAmount;

    /*----------------------------------------------------------
      4. Update Invoice Status
    ----------------------------------------------------------*/
    const updateResult = await client.query(
      `UPDATE invoices 
       SET escrow_status = 'settled', 
           settlement_tx_hash = COALESCE($1, settlement_tx_hash),
           settled_at = NOW()
       WHERE invoice_id = $2 
       RETURNING *`,
      [tx_hash || null, invoiceId]
    );

    if (!updateResult.rows || updateResult.rows.length === 0) {
      logger.error('Failed to update invoice status', { invoiceId });
      throw new Error('Failed to update invoice status');
    }

    await client.query('COMMIT');

    logger.info('Invoice settled early successfully', { invoiceId, settledAmount: offerAmount, discountAmount });

    return res.status(200).json({ 
      success: true, 
      message: 'Invoice settled early successfully',
      invoiceId,
      settledAmount: offerAmount.toFixed(2),
      discountApplied: discountAmount.toFixed(2),
      originalAmount: amount.toFixed(2),
      daysEarlyPayment: daysRemaining,
      txHash: tx_hash || null,
      settledAt: new Date().toISOString(),
      invoice: updateResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackErr => {
      logger.error('Rollback failed during early settlement', { error: rollbackErr.message });
    });

    logger.error('Error settling invoice early', { 
      error: error.message, 
      invoiceId: req.params?.invoiceId,
      userId: req.user?.id,
      stack: error.stack
    });
    
    let statusCode = 500;
    if (error.message.includes('not found')) statusCode = 404;
    if (error.message.includes('Not authorized') || error.message.includes('only settle')) statusCode = 403;
    if (error.message.includes('already') || error.message.includes('overdue') || error.message.includes('due today')) statusCode = 400;
    if (error.message.includes('Invalid') || error.message.includes('missing')) statusCode = 400;

    return errorResponse(res, error.message || 'Failed to settle invoice early', statusCode);
  } finally {
    client.release();
  }
};