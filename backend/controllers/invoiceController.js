const { pool } = require('../config/database');

exports.createInvoice = async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const {
            quotation_id,
            // On-chain data passed from frontend
            invoice_id,
            invoice_hash,
            contract_address,
            token_address,
            due_date
        } = req.body;

        // Basic Input Validation
        if (!quotation_id || !invoice_id || !contract_address) {
            throw new Error('Missing quotation_id or required on-chain data.');
        }

        // 1. Fetch and lock the quotation
        const quotationQuery = `SELECT * FROM quotations WHERE id = $1 FOR UPDATE`;
        const quotationResult = await client.query(quotationQuery, [quotation_id]);

        if (quotationResult.rowCount === 0) {
            throw new Error('Quotation not found');
        }
        
        const quotation = quotationResult.rows[0];

        // 2. Status Validation
        if (quotation.status === 'invoiced') {
            throw new Error('Quotation already invoiced');
        }
        if (quotation.status !== 'approved') {
            throw new Error('Quotation not fully approved');
        }

        // 3. RBAC / Authorization Check
        // Ensure the caller belongs to the seller's organization
        if (quotation.seller_org_id !== req.user.organization_id) {
            throw new Error('Not authorized: Quotation belongs to a different organization.');
        }

        // 4. Quantity Validation
        if (!quotation.quantity || quotation.quantity <= 0) {
             throw new Error("Invalid quantity in quotation");
        }

        // 5. Inventory Management (Produce Lots)
        if (quotation.lot_id) {
            const lotQuery = 'SELECT current_quantity FROM produce_lots WHERE lot_id = $1 FOR UPDATE';
            const lotResult = await client.query(lotQuery, [quotation.lot_id]);

            if (lotResult.rowCount === 0) {
                throw new Error('Produce lot not found.');
            }
            
            const lot = lotResult.rows[0];
            if (parseFloat(lot.current_quantity) < parseFloat(quotation.quantity)) {
                throw new Error(`Insufficient quantity. Only ${lot.current_quantity}kg available.`);
            }

            const updateLotQuery = 'UPDATE produce_lots SET current_quantity = current_quantity - $1 WHERE lot_id = $2';
            await client.query(updateLotQuery, [quotation.quantity, quotation.lot_id]);
        }

        // 6. Insert Invoice
        // Trusting quotation data for financial fields
        const insertInvoiceQuery = `
            INSERT INTO invoices (
                invoice_id, invoice_hash, seller_address, buyer_address,
                amount, due_date, description, items, currency,
                contract_address, token_address, lot_id, quotation_id, escrow_status,
                financing_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'created', 'none')
            RETURNING *
        `;

        // Use env variable for exchange rate or fallback, preserving existing logic
        const pricePerUnit = quotation.price_per_unit / (parseFloat(process.env.EXCHANGE_RATE) || 50.75);

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
            quotation_id
        ];

        const result = await client.query(insertInvoiceQuery, values);

        // 7. Update Quotation Status
        const updateQuotationQuery = `UPDATE quotations SET status = 'invoiced' WHERE id = $1`;
        await client.query(updateQuotationQuery, [quotation_id]);

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: "Invoice created successfully",
            invoice: result.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating invoice from quotation:', error);

        // Determine status code based on error message or default to 500
        let statusCode = 500;
        if (error.message === 'Quotation not found') statusCode = 404;
        if (error.message === 'Quotation already invoiced') statusCode = 400;
        if (error.message === 'Quotation not fully approved') statusCode = 400;
        if (error.message.includes('Not authorized')) statusCode = 403;
        if (error.message.includes('Insufficient quantity')) statusCode = 400;
        if (error.message === 'Missing quotation_id or required on-chain data.') statusCode = 400;

        return res.status(statusCode).json({ error: error.message || 'Internal server error.' });
    } finally {
        client.release();
    }
};
