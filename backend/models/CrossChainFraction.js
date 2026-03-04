const { pool } = require('../config/database');

class CrossChainFraction {
    /**
     * Create a new cross-chain fraction record
     */
    static async create(data) {
        const {
            tokenId,
            invoiceId,
            ownerId,
            ownerWallet,
            amount,
            destinationChain,
            sourceChain = 'finovate-cdk',
            bridgeLockId,
            bridgeTxHash,
            status = 'bridged',
            pricePerFraction
        } = data;

        const query = `
            INSERT INTO cross_chain_fractions 
            (token_id, invoice_id, owner_id, owner_wallet, amount, destination_chain, 
             source_chain, bridge_lock_id, bridge_tx_hash, status, price_per_fraction, bridged_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
            RETURNING *
        `;

        const values = [
            tokenId, invoiceId, ownerId, ownerWallet, amount, destinationChain,
            sourceChain, bridgeLockId, bridgeTxHash, status, pricePerFraction
        ];

        try {
            const result = await pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error creating cross-chain fraction:', error);
            throw error;
        }
    }

    /**
     * Get cross-chain fractions by token ID
     */
    static async findByTokenId(tokenId) {
        const query = `
            SELECT * FROM cross_chain_fractions 
            WHERE token_id = $1 
            ORDER BY created_at DESC
        `;

        try {
            const result = await pool.query(query, [tokenId]);
            return result.rows;
        } catch (error) {
            console.error('Error finding cross-chain fractions by token ID:', error);
            throw error;
        }
    }

    /**
     * Get cross-chain fractions by owner
     */
    static async findByOwner(ownerId) {
        const query = `
            SELECT * FROM cross_chain_fractions 
            WHERE owner_id = $1 
            ORDER BY created_at DESC
        `;

        try {
            const result = await pool.query(query, [ownerId]);
            return result.rows;
        } catch (error) {
            console.error('Error finding cross-chain fractions by owner:', error);
            throw error;
        }
    }

    /**
     * Update cross-chain fraction status
     */
    static async updateStatus(id, status) {
        const query = `
            UPDATE cross_chain_fractions 
            SET status = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING *
        `;

        try {
            const result = await pool.query(query, [status, id]);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating cross-chain fraction status:', error);
            throw error;
        }
    }

    /**
     * Mark fraction as returned
     */
    static async markAsReturned(id) {
        const query = `
            UPDATE cross_chain_fractions 
            SET status = 'returned', returned_at = NOW(), updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;

        try {
            const result = await pool.query(query, [id]);
            return result.rows[0];
        } catch (error) {
            console.error('Error marking cross-chain fraction as returned:', error);
            throw error;
        }
    }
}

class CrossChainMarketplaceListing {
    /**
     * Create a new cross-chain marketplace listing
     */
    static async create(data) {
        const {
            tokenId,
            invoiceId,
            sellerId,
            sellerWallet,
            amount,
            pricePerFraction,
            destinationChain,
            sourceChain = 'finovate-cdk',
            expiresAt
        } = data;

        const query = `
            INSERT INTO cross_chain_marketplace_listings 
            (token_id, invoice_id, seller_id, seller_wallet, amount, remaining_amount, 
             price_per_fraction, destination_chain, source_chain, expires_at)
            VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9)
            RETURNING *
        `;

        const values = [
            tokenId, invoiceId, sellerId, sellerWallet, amount,
            pricePerFraction, destinationChain, sourceChain, expiresAt
        ];

        try {
            const result = await pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error creating cross-chain marketplace listing:', error);
            throw error;
        }
    }

    /**
     * Get active listings by destination chain
     */
    static async findActiveByChain(destinationChain) {
        const query = `
            SELECT * FROM cross_chain_marketplace_listings 
            WHERE destination_chain = $1 AND listing_status = 'active' AND remaining_amount > 0
            ORDER BY created_at DESC
        `;

        try {
            const result = await pool.query(query, [destinationChain]);
            return result.rows;
        } catch (error) {
            console.error('Error finding active listings by chain:', error);
            throw error;
        }
    }

    /**
     * Get listing by ID
     */
    static async findById(id) {
        const query = `
            SELECT * FROM cross_chain_marketplace_listings 
            WHERE id = $1
        `;

        try {
            const result = await pool.query(query, [id]);
            return result.rows[0];
        } catch (error) {
            console.error('Error finding listing by ID:', error);
            throw error;
        }
    }

    /**
     * Update listing after trade
     */
    static async updateAfterTrade(id, tradeAmount) {
        const query = `
            UPDATE cross_chain_marketplace_listings 
            SET remaining_amount = remaining_amount - $1,
                total_sold = total_sold + $1,
                updated_at = NOW(),
                listing_status = CASE 
                    WHEN remaining_amount - $1 <= 0 THEN 'sold_out' 
                    ELSE listing_status 
                END
            WHERE id = $2
            RETURNING *
        `;

        try {
            const result = await pool.query(query, [tradeAmount, id]);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating listing after trade:', error);
            throw error;
        }
    }

    /**
     * Get listings by seller
     */
    static async findBySeller(sellerId) {
        const query = `
            SELECT * FROM cross_chain_marketplace_listings 
            WHERE seller_id = $1 
            ORDER BY created_at DESC
        `;

        try {
            const result = await pool.query(query, [sellerId]);
            return result.rows;
        } catch (error) {
            console.error('Error finding listings by seller:', error);
            throw error;
        }
    }
}

class CrossChainTrade {
    /**
     * Record a new cross-chain trade
     */
    static async create(data) {
        const {
            listingId,
            tokenId,
            invoiceId,
            sellerId,
            buyerId,
            sellerWallet,
            buyerWallet,
            amount,
            pricePerFraction,
            totalPrice,
            destinationChain,
            tradeTxHash,
            status = 'completed'
        } = data;

        const query = `
            INSERT INTO cross_chain_trades 
            (listing_id, token_id, invoice_id, seller_id, buyer_id, seller_wallet, 
             buyer_wallet, amount, price_per_fraction, total_price, destination_chain, 
             trade_tx_hash, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `;

        const values = [
            listingId, tokenId, invoiceId, sellerId, buyerId, sellerWallet,
            buyerWallet, amount, pricePerFraction, totalPrice, destinationChain,
            tradeTxHash, status
        ];

        try {
            const result = await pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error creating cross-chain trade:', error);
            throw error;
        }
    }

    /**
     * Get trades by buyer
     */
    static async findByBuyer(buyerId) {
        const query = `
            SELECT * FROM cross_chain_trades 
            WHERE buyer_id = $1 
            ORDER BY created_at DESC
        `;

        try {
            const result = await pool.query(query, [buyerId]);
            return result.rows;
        } catch (error) {
            console.error('Error finding trades by buyer:', error);
            throw error;
        }
    }

    /**
     * Get trades by seller
     */
    static async findBySeller(sellerId) {
        const query = `
            SELECT * FROM cross_chain_trades 
            WHERE seller_id = $1 
            ORDER BY created_at DESC
        `;

        try {
            const result = await pool.query(query, [sellerId]);
            return result.rows;
        } catch (error) {
            console.error('Error finding trades by seller:', error);
            throw error;
        }
    }
}

module.exports = {
    CrossChainFraction,
    CrossChainMarketplaceListing,
    CrossChainTrade
};
