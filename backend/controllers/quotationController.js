const { pool } = require('../config/database');
const marketService = require('../services/marketService');

exports.createQuotation = async (req, res) => {
    try {
        const { lot_id, seller_address, buyer_address, quantity, price_per_unit, description } = req.body;
        const creator_address = req.user.wallet_address;

        let final_seller_address = seller_address;
        let final_buyer_address = buyer_address;
        let final_price_per_unit = price_per_unit;
        let status;
        let final_description = description;

        // Flow 1: Buyer creates a quotation for an on-platform produce lot
        if (lot_id) {
            if (!seller_address) return res.status(400).json({ error: 'Seller address is required for produce quotations.' });
            
            const lotQuery = 'SELECT produce_type, current_quantity FROM produce_lots WHERE lot_id = $1';
            const lotResult = await pool.query(lotQuery, [lot_id]);
            if (lotResult.rows.length === 0) {
                return res.status(404).json({ error: 'Produce lot not found.' });
            }
            const lot = lotResult.rows[0];

            if (parseFloat(quantity) > parseFloat(lot.current_quantity)) {
                return res.status(400).json({ error: `Requested quantity exceeds available stock of ${lot.current_quantity}kg.` });
            }

            // Fetch live market price and override any client-side price
            const marketPrice = await marketService.getPricePerKg(lot.produce_type);
            if (marketPrice === null) {
                return res.status(503).json({ error: `Could not retrieve a valid market price for ${lot.produce_type}. Please try again later.` });
            }
            final_price_per_unit = marketPrice;
            
            final_description = `${quantity}kg of ${lot.produce_type} from lot #${lot_id}`;
            final_buyer_address = creator_address;
            status = 'pending_seller_approval';
        } 
        // Flow 2: Seller creates a quotation for an off-platform deal
        else {
            if (!buyer_address) return res.status(400).json({ error: 'Buyer address is required for off-platform quotations.' });
            if (!price_per_unit) return res.status(400).json({ error: 'Price must be specified for off-platform quotations.' });
            final_seller_address = creator_address;
            status = 'pending_buyer_approval';
        }

        if (!final_seller_address || !final_buyer_address || !quantity || !final_price_per_unit) {
            return res.status(400).json({ error: 'Missing required fields for quotation.' });
        }

        const total_amount = parseFloat(quantity) * parseFloat(final_price_per_unit);

        const query = `
            INSERT INTO quotations 
            (lot_id, creator_address, seller_address, buyer_address, quantity, price_per_unit, 
             total_amount, currency, description, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `;
        const values = [lot_id || null, creator_address, final_seller_address, final_buyer_address, quantity, final_price_per_unit, total_amount, 'MATIC', final_description, status];

        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error('Error creating quotation:', error);
        res.status(500).json({ error: 'Failed to create quotation.' });
    }
};

// Seller's action: Approves a quotation created by a buyer
exports.sellerApproveQuotation = async (req, res) => {
    try {
        const { id } = req.params;
        const seller_address = req.user.wallet_address;

        const query = `
            UPDATE quotations 
            SET status = 'pending_buyer_approval', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND seller_address = $2 AND status = 'pending_seller_approval'
            RETURNING *
        `;
        const result = await pool.query(query, [id, seller_address]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pending quotation not found or you are not authorized.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error (seller) approving quotation:', error);
        res.status(500).json({ error: 'Failed to approve quotation.' });
    }
};

// Buyer's action: Approves a quotation created/approved by a seller
exports.buyerApproveQuotation = async (req, res) => {
    try {
        const { id } = req.params;
        const buyer_address = req.user.wallet_address;

        const query = `
            UPDATE quotations 
            SET status = 'approved', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND buyer_address = $2 AND status = 'pending_buyer_approval'
            RETURNING *
        `;
        const result = await pool.query(query, [id, buyer_address]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Quotation waiting for your approval not found or not authorized.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error (buyer) approving quotation:', error);
        res.status(500).json({ error: 'Failed to approve quotation.' });
    }
};


// Get all quotations for the current user
exports.getQuotations = async (req, res) => {
    try {
        const user_address = req.user.wallet_address;
        const query = `
            SELECT q.*, p.produce_type 
            FROM quotations q
            LEFT JOIN produce_lots p ON q.lot_id = p.lot_id
            WHERE q.seller_address = $1 OR q.buyer_address = $1
            ORDER BY q.created_at DESC
        `;
        const result = await pool.query(query, [user_address]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching quotations:', error);
        res.status(500).json({ error: 'Failed to fetch quotations.' });
    }
};


// Either party can reject a quotation that is not fully approved
exports.rejectQuotation = async (req, res) => {
    try {
        const { id } = req.params;
        const user_address = req.user.wallet_address;

        const query = `
            UPDATE quotations 
            SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND (seller_address = $2 OR buyer_address = $2) AND status IN ('pending_seller_approval', 'pending_buyer_approval')
            RETURNING *
        `;
        const result = await pool.query(query, [id, user_address]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Actionable quotation not found or you are not authorized.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error rejecting quotation:', error);
        res.status(500).json({ error: 'Failed to reject quotation.' });
    }
};

exports.getPendingBuyerApprovals = async (req, res) => {
    try {
        const buyer_address = req.user.wallet_address;
        const query = `
            SELECT 
                q.*, 
                u.email as seller_name,
                -- Also select produce_type for on-platform quotes
                p.produce_type 
            FROM quotations q
            JOIN users u ON q.seller_address = u.wallet_address
            -- Use LEFT JOIN in case it's an off-platform quote with no lot
            LEFT JOIN produce_lots p ON q.lot_id = p.lot_id
            WHERE q.buyer_address = $1 
              AND q.status = 'pending_buyer_approval'
              -- REMOVED: AND q.lot_id IS NULL 
            ORDER BY q.created_at DESC
        `;
        const result = await pool.query(query, [buyer_address]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching pending buyer approvals:', error);
        res.status(500).json({ error: 'Failed to fetch pending approvals.' });
    }
};