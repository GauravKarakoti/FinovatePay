const pool = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

exports.createInvoice = asyncHandler(async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      quotation_id,
      invoice_id,
      invoice_hash,
      contract_address,
      token_address,
      due_date,
    } = req.body;

    if (!quotation_id || !invoice_id || !contract_address) {
      throw new AppError(
        'Missing quotation_id or required on-chain data.',
        400
      );
    }

    await client.query('BEGIN');

    // 1. Fetch and lock quotation
    const quotationQuery = `
      SELECT * FROM quotations
      WHERE id = $1 AND status = 'approved'
      FOR UPDATE
    `;
    const quotationResult = await client.query(quotationQuery, [quotation_id]);

    if (quotationResult.rows.length === 0) {
      throw new AppError(
        'Quotation not found, not fully approved, or already invoiced.',
        404
      );
    }

    const quotation = quotationResult.rows[0];

    // RBAC check
    if (quotation.seller_org_id !== req.user.organization_id) {
      throw new AppError(
        'Not authorized: Quotation belongs to a different organization.',
        403
      );
    }

    // 2. Handle produce lot inventory
    if (quotation.lot_id) {
      const lotQuery = `
        SELECT current_quantity
        FROM produce_lots
        WHERE lot_id = $1
        FOR UPDATE
      `;
      const lotResult = await client.query(lotQuery, [quotation.lot_id]);

      if (lotResult.rows.length === 0) {
        throw new AppError('Produce lot not found.', 404);
      }

      const lot = lotResult.rows[0];

      if (
        parseFloat(lot.current_quantity) <
        parseFloat(quotation.quantity)
      ) {
        throw new AppError(
          `Insufficient quantity. Only ${lot.current_quantity}kg available.`,
          400
        );
      }

      const updateLotQuery = `
        UPDATE produce_lots
        SET current_quantity = current_quantity - $1
        WHERE lot_id = $2
      `;
      await client.query(updateLotQuery, [
        quotation.quantity,
        quotation.lot_id,
      ]);
    }

    // 3. Insert invoice
    const insertInvoiceQuery = `
      INSERT INTO invoices (
        invoice_id, invoice_hash, seller_address, buyer_address,
        amount, due_date, description, items, currency,
        contract_address, token_address, lot_id, quotation_id,
        escrow_status, financing_status
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, 'created', 'none'
      )
      RETURNING *
    `;

    const values = [
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
          price_per_unit: quotation.price_per_unit / 50.75,
        },
      ]),
      quotation.currency,
      contract_address,
      token_address,
      quotation.lot_id,
      quotation_id,
    ];

    const result = await client.query(insertInvoiceQuery, values);

    // 4. Update quotation status
    const updateQuotationQuery = `
      UPDATE quotations
      SET status = 'invoiced'
      WHERE id = $1
    `;
    await client.query(updateQuotationQuery, [quotation_id]);

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      invoice: result.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; 
  } finally {
    client.release();
  }
});
