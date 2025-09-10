const pool = require('../config/database');

exports.createInvoice = async (req, res) => {
    try {
        const { 
            buyer_address, amount, due_date, description, items, currency,
            invoice_id, invoice_hash, contract_address, token_address // New fields
        } = req.body;
        
        if (!invoice_id || !invoice_hash || !contract_address || !token_address) {
             return res.status(400).json({ error: 'Missing required on-chain invoice data.' });
        }

        const query = `
            INSERT INTO invoices (
                invoice_id, invoice_hash, seller_address, buyer_address, 
                amount, due_date, description, items, currency,
                contract_address, token_address, escrow_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'created')
            RETURNING *
        `;
        
        const values = [
            invoice_id, invoice_hash, req.user.wallet_address, buyer_address, 
            amount, due_date, description, JSON.stringify(items), currency,
            contract_address, token_address
        ];

        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(500).json({ error: 'Failed to save invoice to database.' });
        }

        res.status(201).json({ success: true, invoice: result.rows[0] });

    } catch (error) {
        console.error('Error creating invoice:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
};