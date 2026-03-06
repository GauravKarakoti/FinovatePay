const { pool } = require('../config/database');

/**
 * RevolvingCreditLine Model
 * Manages database operations for revolving credit lines
 */

class RevolvingCreditLine {
    /**
     * Create a new credit line record
     */
    static async create(data) {
        const {
            creditLineId,
            userId,
            walletAddress,
            creditLimit,
            interestRate,
            collateralTokenId,
            collateralAmount,
            collateralValue
        } = data;

        const query = `
            INSERT INTO revolving_credit_lines (
                credit_line_id,
                user_id,
                wallet_address,
                credit_limit,
                drawn_amount,
                interest_rate,
                collateral_token_id,
                collateral_amount,
                collateral_value,
                is_active,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `;

        const values = [
            creditLineId,
            userId,
            walletAddress,
            creditLimit,
            '0', // drawn_amount starts at 0
            interestRate,
            collateralTokenId,
            collateralAmount,
            collateralValue,
            true,
            'active'
        ];

        try {
            const result = await pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('[RevolvingCreditLine] Error creating credit line:', error);
            throw error;
        }
    }

    /**
     * Find credit line by credit line ID
     */
    static async findById(creditLineId) {
        const query = `
            SELECT * FROM revolving_credit_lines 
            WHERE credit_line_id = $1
        `;

        try {
            const result = await pool.query(query, [creditLineId]);
            return result.rows[0];
        } catch (error) {
            console.error('[RevolvingCreditLine] Error finding credit line by ID:', error);
            throw error;
        }
    }

    /**
     * Find credit line by user ID
     */
    static async findByUserId(userId) {
        const query = `
            SELECT * FROM revolving_credit_lines 
            WHERE user_id = $1 AND is_active = true
        `;

        try {
            const result = await pool.query(query, [userId]);
            return result.rows[0];
        } catch (error) {
            console.error('[RevolvingCreditLine] Error finding credit line by user ID:', error);
            throw error;
        }
    }

    /**
     * Find credit line by wallet address
     */
    static async findByWallet(walletAddress) {
        const query = `
            SELECT * FROM revolving_credit_lines 
            WHERE wallet_address = $1 AND is_active = true
        `;

        try {
            const result = await pool.query(query, [walletAddress]);
            return result.rows[0];
        } catch (error) {
            console.error('[RevolvingCreditLine] Error finding credit line by wallet:', error);
            throw error;
        }
    }

    /**
     * Update credit line drawn amount
     */
    static async updateDrawnAmount(creditLineId, newDrawnAmount) {
        const query = `
            UPDATE revolving_credit_lines 
            SET drawn_amount = $2,
                updated_at = NOW(),
                last_transaction_at = NOW()
            WHERE credit_line_id = $1
            RETURNING *
        `;

        try {
            const result = await pool.query(query, [creditLineId, newDrawnAmount]);
            return result.rows[0];
        } catch (error) {
            console.error('[RevolvingCreditLine] Error updating drawn amount:', error);
            throw error;
        }
    }

    /**
     * Update credit line status
     */
    static async updateStatus(creditLineId, status) {
        const query = `
            UPDATE revolving_credit_lines 
            SET status = $2,
                is_active = $3,
                updated_at = NOW()
            WHERE credit_line_id = $1
            RETURNING *
        `;

        const isActive = status === 'active';
        const values = [creditLineId, status, isActive];

        try {
            const result = await pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('[RevolvingCreditLine] Error updating status:', error);
            throw error;
        }
    }

    /**
     * Update collateral amount
     */
    static async updateCollateral(creditLineId, collateralAmount, collateralValue) {
        const query = `
            UPDATE revolving_credit_lines 
            SET collateral_amount = $2,
                collateral_value = $3,
                updated_at = NOW(),
                last_transaction_at = NOW()
            WHERE credit_line_id = $1
            RETURNING *
        `;

        try {
            const result = await pool.query(query, [creditLineId, collateralAmount, collateralValue]);
            return result.rows[0];
        } catch (error) {
            console.error('[RevolvingCreditLine] Error updating collateral:', error);
            throw error;
        }
    }

    /**
     * Record a transaction
     */
    static async recordTransaction(data) {
        const {
            creditLineId,
            transactionType,
            amount,
            interestPaid,
            transactionHash,
            fromAddress,
            toAddress,
            status,
            metadata
        } = data;

        const query = `
            INSERT INTO credit_line_transactions (
                credit_line_id,
                transaction_type,
                amount,
                interest_paid,
                transaction_hash,
                from_address,
                to_address,
                status,
                metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `;

        const values = [
            creditLineId,
            transactionType,
            amount,
            interestPaid || '0',
            transactionHash,
            fromAddress,
            toAddress,
            status || 'confirmed',
            metadata ? JSON.stringify(metadata) : null
        ];

        try {
            const result = await pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('[RevolvingCreditLine] Error recording transaction:', error);
            throw error;
        }
    }

    /**
     * Get transaction history for a credit line
     */
    static async getTransactionHistory(creditLineId, limit = 50) {
        const query = `
            SELECT * FROM credit_line_transactions 
            WHERE credit_line_id = $1
            ORDER BY created_at DESC
            LIMIT $2
        `;

        try {
            const result = await pool.query(query, [creditLineId, limit]);
            return result.rows;
        } catch (error) {
            console.error('[RevolvingCreditLine] Error getting transaction history:', error);
            throw error;
        }
    }

    /**
     * Record interest accrual
     */
    static async recordInterestAccrual(data) {
        const {
            creditLineId,
            periodStart,
            periodEnd,
            startingBalance,
            interestRate,
            interestAccrued
        } = data;

        const query = `
            INSERT INTO credit_line_interest_accruals (
                credit_line_id,
                period_start,
                period_end,
                starting_balance,
                interest_rate,
                interest_accrued
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;

        const values = [
            creditLineId,
            periodStart,
            periodEnd,
            startingBalance,
            interestRate,
            interestAccrued
        ];

        try {
            const result = await pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('[RevolvingCreditLine] Error recording interest accrual:', error);
            throw error;
        }
    }

    /**
     * Record collateral history
     */
    static async recordCollateralHistory(data) {
        const {
            creditLineId,
            tokenId,
            amountBefore,
            amountAfter,
            action,
            transactionHash
        } = data;

        const query = `
            INSERT INTO credit_line_collateral_history (
                credit_line_id,
                token_id,
                amount_before,
                amount_after,
                action,
                transaction_hash
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;

        const values = [
            creditLineId,
            tokenId,
            amountBefore,
            amountAfter,
            action,
            transactionHash
        ];

        try {
            const result = await pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('[RevolvingCreditLine] Error recording collateral history:', error);
            throw error;
        }
    }

    /**
     * Get configuration parameter
     */
    static async getConfig(parameterKey, userId = null) {
        let query;
        let values;

        if (userId) {
            // Check user-specific config first, then global
            query = `
                SELECT parameter_value FROM credit_line_config 
                WHERE parameter_key = $1 AND user_id = $2
                UNION ALL
                SELECT parameter_value FROM credit_line_config 
                WHERE parameter_key = $1 AND is_global = true AND user_id IS NULL
                LIMIT 1
            `;
            values = [parameterKey, userId];
        } else {
            query = `
                SELECT parameter_value FROM credit_line_config 
                WHERE parameter_key = $1 AND is_global = true
            `;
            values = [parameterKey];
        }

        try {
            const result = await pool.query(query, values);
            return result.rows[0]?.parameter_value;
        } catch (error) {
            console.error('[RevolvingCreditLine] Error getting config:', error);
            throw error;
        }
    }

    /**
     * Get all active credit lines (admin function)
     */
    static async getAllActive(limit = 100, offset = 0) {
        const query = `
            SELECT * FROM revolving_credit_lines 
            WHERE is_active = true
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `;

        try {
            const result = await pool.query(query, [limit, offset]);
            return result.rows;
        } catch (error) {
            console.error('[RevolvingCreditLine] Error getting all active credit lines:', error);
            throw error;
        }
    }

    /**
     * Get credit line with user details
     */
    static async getWithUserDetails(creditLineId) {
        const query = `
            SELECT 
                rcl.*,
                u.email,
                u.kyc_status,
                cs.score as credit_score
            FROM revolving_credit_lines rcl
            JOIN users u ON rcl.user_id = u.id
            LEFT JOIN credit_scores cs ON rcl.user_id = cs.user_id
            WHERE rcl.credit_line_id = $1
        `;

        try {
            const result = await pool.query(query, [creditLineId]);
            return result.rows[0];
        } catch (error) {
            console.error('[RevolvingCreditLine] Error getting credit line with user details:', error);
            throw error;
        }
    }
}

module.exports = RevolvingCreditLine;
