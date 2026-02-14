const { pool } = require('../config/database');
const { EXCHANGE_RATE } = require('../config/constants');

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

        await client.query('BEGIN');

        // 1. Fetch and lock the quotation, ensuring it's fully approved.
        const quotationQuery = `SELECT * FROM quotations WHERE id = $1 AND status = 'approved' FOR UPDATE`;
        const quotationResult = await client.query(quotationQuery, [quotation_id]);

        if (quotationResult.rows.length === 0) {
            throw new Error('Quotation not found, not fully approved, or already invoiced.');
        }
        const quotation = quotationResult.rows[0];
        
        // TWEAK: RBAC - Check Organization ID instead of Wallet Address
        // This allows any authorized user in the company to process the invoice
        if (quotation.seller_org_id !== req.user.organization_id) {
            throw new Error('Not authorized: Quotation belongs to a different organization.');
        }

        // 2. If it's a produce lot, fetch, lock, and update the inventory
        if (quotation.lot_id) {
            const lotQuery = 'SELECT current_quantity FROM produce_lots WHERE lot_id = $1 FOR UPDATE';
            const lotResult = await client.query(lotQuery, [quotation.lot_id]);

            if (lotResult.rows.length === 0) throw new Error('Produce lot not found.');
            
            const lot = lotResult.rows[0];
            if (parseFloat(lot.current_quantity) < parseFloat(quotation.quantity)) {
                throw new Error(`Insufficient quantity. Only ${lot.current_quantity}kg available.`);
            }

            const updateLotQuery = 'UPDATE produce_lots SET current_quantity = current_quantity - $1 WHERE lot_id = $2';
            await client.query(updateLotQuery, [quotation.quantity, quotation.lot_id]);
        }

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
                price_per_unit: quotation.price_per_unit / EXCHANGE_RATE
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
};