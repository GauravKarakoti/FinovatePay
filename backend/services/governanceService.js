const { pool } = require('../config/database');
const { ethers } = require('ethers');
const { getSigner, contractAddresses } = require('../config/blockchain');

/**
 * Governance Service - Business Logic for DAO Governance
 */

class GovernanceService {
    
    /**
     * Create a new governance proposal
     */
    async createProposal(params) {
        const {
            title,
            description,
            category,
            proposerWallet,
            targetContract,
            calldata,
            value = 0,
            proposalId,
            startBlock,
            endBlock,
            txHash
        } = params;

        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            const query = `
                INSERT INTO governance_proposals (
                    proposal_id, title, description, category,
                    proposer_wallet, target_contract, calldata, value,
                    status, start_block, end_block, created_at,
                    for_votes, against_votes, abstain_votes,
                    description_hash
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), 0, 0, 0, $12)
                ON CONFLICT (proposal_id) DO UPDATE SET
                    title = EXCLUDED.title,
                    description = EXCLUDED.description,
                    status = 'ACTIVE'
                RETURNING *
            `;

            const values = [
                proposalId,
                title,
                description,
                category,
                proposerWallet.toLowerCase(),
                targetContract,
                calldata || null,
                value,
                'ACTIVE',
                startBlock,
                endBlock,
                ethers.id(description).slice(0, 66)
            ];

            const result = await client.query(query, values);
            
            // Log event
            await client.query(
                `INSERT INTO governance_events (event_type, proposal_id, wallet, data, tx_hash)
                 VALUES ($1, $2, $3, $4, $5)`,
                ['PROPOSAL_CREATED', proposalId, proposerWallet.toLowerCase(), JSON.stringify({ title, category }), txHash]
            );

            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Cast a vote on a proposal
     */
    async castVote(params) {
        const {
            proposalId,
            voterWallet,
            support,
            voteWeight,
            txHash,
            blockNumber
        } = params;

        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Check if proposal exists and is active
            const proposalCheck = await client.query(
                `SELECT status, for_votes, against_votes FROM governance_proposals WHERE proposal_id = $1`,
                [proposalId]
            );

            if (proposalCheck.rows.length === 0) {
                throw new Error('Proposal not found');
            }

            const proposal = proposalCheck.rows[0];
            if (proposal.status !== 'ACTIVE') {
                throw new Error('Proposal is not active for voting');
            }

            const supportEnum = support ? 'FOR' : 'AGAINST';

            // Insert or update vote
            const voteQuery = `
                INSERT INTO governance_votes (
                    proposal_id, voter_wallet, vote_weight, support, support_enum,
                    tx_hash, block_number, block_timestamp
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                ON CONFLICT (proposal_id, voter_wallet) DO UPDATE SET
                    vote_weight = EXCLUDED.vote_weight,
                    support = EXCLUDED.support,
                    support_enum = EXCLUDED.support_enum,
                    tx_hash = EXCLUDED.tx_hash,
                    block_number = EXCLUDED.block_number
                RETURNING *
            `;

            await client.query(voteQuery, [
                proposalId,
                voterWallet.toLowerCase(),
                voteWeight,
                support,
                supportEnum,
                txHash,
                blockNumber
            ]);

            // Update proposal vote counts
            const updateQuery = support
                ? `UPDATE governance_proposals SET for_votes = for_votes + $1 WHERE proposal_id = $2`
                : `UPDATE governance_proposals SET against_votes = against_votes + $1 WHERE proposal_id = $2`;

            await client.query(updateQuery, [voteWeight, proposalId]);

            // Log event
            await client.query(
                `INSERT INTO governance_events (event_type, proposal_id, wallet, data, tx_hash)
                 VALUES ($1, $2, $3, $4, $5)`,
                ['VOTE_CAST', proposalId, voterWallet.toLowerCase(), JSON.stringify({ support: supportEnum, weight: voteWeight }), txHash]
            );

            await client.query('COMMIT');
            
            // Check if proposal should change status
            await this.checkProposalStatus(proposalId);
            
            return { success: true, proposalId, voter: voterWallet.toLowerCase(), support };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Check and update proposal status based on vote counts
     */
    async checkProposalStatus(proposalId) {
        const client = await pool.connect();
        
        try {
            const result = await client.query(
                `SELECT * FROM governance_proposals WHERE proposal_id = $1`,
                [proposalId]
            );

            if (result.rows.length === 0) return;

            const proposal = result.rows[0];
            
            // Get current quorum requirement
            const quorumResult = await client.query(
                `SELECT current_value FROM governance_parameters WHERE parameter_name = 'quorumPercentage'`
            );
            
            const quorumPercentage = quorumResult.rows.length > 0 
                ? parseInt(quorumResult.rows[0].current_value) 
                : 4;
            
            // Simple quorum check (in practice this would be more complex)
            const totalVotes = BigInt(proposal.for_votes) + BigInt(proposal.against_votes);
            const quorumRequired = BigInt(quorumPercentage) * BigInt(1000000000000000000n); // Simplified
            
            // Update status based on votes
            if (proposal.for_votes > proposal.against_votes && totalVotes > 0) {
                // Check if voting period has ended
                const now = Math.floor(Date.now() / 1000);
                if (proposal.end_block && now > proposal.end_block * 12) { // Rough block time conversion
                    await client.query(
                        `UPDATE governance_proposals SET status = 'SUCCEEDED', executed_at = NOW() WHERE proposal_id = $1`,
                        [proposalId]
                    );
                }
            } else if (proposal.against_votes > proposal.for_votes) {
                await client.query(
                    `UPDATE governance_proposals SET status = 'DEFEATED' WHERE proposal_id = $1`,
                    [proposalId]
                );
            }
        } finally {
            client.release();
        }
    }

    /**
     * Get all proposals with filters
     */
    async getProposals(filters = {}) {
        const { status, category, limit = 20, offset = 0 } = filters;
        
        let query = 'SELECT * FROM governance_proposals WHERE 1=1';
        const params = [];
        let paramCount = 1;

        if (status) {
            query += ` AND status = $${paramCount++}`;
            params.push(status);
        }

        if (category) {
            query += ` AND category = $${paramCount++}`;
            params.push(category);
        }

        query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        return result.rows;
    }

    /**
     * Get a specific proposal
     */
    async getProposal(proposalId) {
        const result = await pool.query(
            `SELECT * FROM governance_proposals WHERE proposal_id = $1`,
            [proposalId]
        );
        return result.rows[0];
    }

    /**
     * Get votes for a proposal
     */
    async getProposalVotes(proposalId) {
        const result = await pool.query(
            `SELECT * FROM governance_votes WHERE proposal_id = $1 ORDER BY vote_weight DESC`,
            [proposalId]
        );
        return result.rows;
    }

    /**
     * Get user's vote for a proposal
     */
    async getUserVote(proposalId, walletAddress) {
        const result = await pool.query(
            `SELECT * FROM governance_votes WHERE proposal_id = $1 AND voter_wallet = $2`,
            [proposalId, walletAddress.toLowerCase()]
        );
        return result.rows[0];
    }

    /**
     * Get governance parameters
     */
    async getParameters() {
        const result = await pool.query(
            `SELECT * FROM governance_parameters ORDER BY parameter_name`
        );
        return result.rows;
    }

    /**
     * Update a governance parameter
     */
    async updateParameter(parameterName, newValue, updatedBy) {
        const result = await pool.query(
            `UPDATE governance_parameters 
             SET current_value = $1, updated_at = NOW(), updated_by = $2
             WHERE parameter_name = $3
             RETURNING *`,
            [newValue, updatedBy.toLowerCase(), parameterName]
        );
        return result.rows[0];
    }

    /**
     * Queue a parameter change (pending)
     */
    async queueParameterChange(parameterName, newValue, proposalId, executionTime) {
        const result = await pool.query(
            `UPDATE governance_parameters 
             SET pending_value = $1, proposal_id = $2, execution_time = $3, updated_at = NOW()
             WHERE parameter_name = $4
             RETURNING *`,
            [newValue, proposalId, executionTime, parameterName]
        );
        return result.rows[0];
    }

    /**
     * Execute a queued parameter change
     */
    async executeParameterChange(parameterName) {
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Get pending change
            const paramResult = await client.query(
                `SELECT * FROM governance_parameters WHERE parameter_name = $1 AND pending_value IS NOT NULL`,
                [parameterName]
            );

            if (paramResult.rows.length === 0 || !paramResult.rows[0].execution_time) {
                throw new Error('No pending parameter change');
            }

            const pending = paramResult.rows[0];
            
            // Check if execution time has passed
            if (new Date(pending.execution_time) > new Date()) {
                throw new Error('Parameter change not yet executable');
            }

            // Execute the change
            await client.query(
                `UPDATE governance_parameters 
                 SET current_value = pending_value, 
                     pending_value = NULL, 
                     proposal_id = NULL, 
                     execution_time = NULL,
                     updated_at = NOW()
                 WHERE parameter_name = $1`,
                [parameterName]
            );

            await client.query('COMMIT');
            return { success: true, parameterName, newValue: pending.pending_value };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get delegate information for a wallet
     */
    async getDelegation(delegatorWallet) {
        const result = await pool.query(
            `SELECT * FROM governance_delegations 
             WHERE delegator_wallet = $1 AND is_active = true`,
            [delegatorWallet.toLowerCase()]
        );
        return result.rows[0];
    }

    async getVotingPower(walletAddress) {
        try {
            // ABI fragment just for the getVotes function inherited from ERC20Votes
            const abi = ["function getVotes(address account) view returns (uint256)"];
            const signer = getSigner(); // You are already importing this at the top of the file
            
            // Connect to the FinovateToken contract
            const tokenContract = new ethers.Contract(contractAddresses.FinovateToken, abi, signer);
            
            // Fetch real-time on-chain voting power
            const onChainVotes = await tokenContract.getVotes(walletAddress);
            
            return { 
                wallet: walletAddress.toLowerCase(), 
                votes: onChainVotes.toString() // Return as string to handle BigInt safely
            };
        } catch (error) {
            console.error("Failed to fetch on-chain voting power:", error);
            
            // Fallback to database if RPC fails
            const result = await pool.query(
                `SELECT * FROM governance_token_holders WHERE wallet = $1`,
                [walletAddress.toLowerCase()]
            );
            
            if (result.rows.length === 0) {
                return { wallet: walletAddress.toLowerCase(), votes: 0 };
            }
            return result.rows[0];
        }
    }

    /**
     * Get proposal statistics
     */
    async getProposalStats() {
        const result = await pool.query(`
            SELECT 
                status,
                COUNT(*) as count,
                SUM(for_votes) as total_for,
                SUM(against_votes) as total_against
            FROM governance_proposals 
            GROUP BY status
        `);
        
        const stats = {
            total: 0,
            active: 0,
            executed: 0,
            defeated: 0
        };
        
        result.rows.forEach(row => {
            stats.total += parseInt(row.count);
            if (row.status === 'ACTIVE') stats.active = parseInt(row.count);
            if (row.status === 'EXECUTED') stats.executed = parseInt(row.count);
            if (row.status === 'DEFEATED') stats.defeated = parseInt(row.count);
        });
        
        return stats;
    }
}

module.exports = new GovernanceService();

