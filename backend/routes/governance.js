const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const governanceService = require('../services/governanceService');
const { getSigner } = require('../config/blockchain');
const errorResponse = require('../utils/errorResponse');

// All governance routes require authentication
router.use(authenticateToken);
router.use(requireKYC);

/**
 * GET /api/governance/proposals
 * Get all governance proposals
 */
router.get('/proposals', async (req, res) => {
    try {
        const { status, category, limit, offset } = req.query;
        
        const proposals = await governanceService.getProposals({
            status,
            category,
            limit: parseInt(limit) || 20,
            offset: parseInt(offset) || 0
        });

        res.json({
            success: true,
            count: proposals.length,
            proposals
        });
    } catch (error) {
        console.error('Error fetching proposals:', error);
        return errorResponse(res, error.message, 500);
    }
});

/**
 * GET /api/governance/proposals/:proposalId
 * Get a specific proposal
 */
router.get('/proposals/:proposalId', async (req, res) => {
    try {
        const { proposalId } = req.params;
        
        const proposal = await governanceService.getProposal(proposalId);
        
        if (!proposal) {
            return errorResponse(res, 'Proposal not found', 404);
        }

        // Get votes for this proposal
        const votes = await governanceService.getProposalVotes(proposalId);
        
        // Get user's vote if authenticated
        let userVote = null;
        if (req.user.wallet_address) {
            userVote = await governanceService.getUserVote(proposalId, req.user.wallet_address);
        }

        res.json({
            success: true,
            proposal,
            votes,
            userVote
        });
    } catch (error) {
        console.error('Error fetching proposal:', error);
        return errorResponse(res, error.message, 500);
    }
});

/**
 * POST /api/governance/proposals
 * Create a new proposal (requires sufficient token balance)
 */
router.post('/proposals', requireRole(['admin', 'investor']), async (req, res) => {
    try {
        const { title, description, category, targetContract, calldata, value } = req.body;
        const proposerWallet = req.user.wallet_address;

        // Validate required fields
        if (!title || !description || !category) {
            return errorResponse(res, 'Title, description, and category are required', 400);
        }

        // Validate category
        const validCategories = ['PARAMETER_UPDATE', 'FEE_UPDATE', 'TREASURY_UPDATE', 'EMERGENCY', 'UPGRADE', 'GENERAL'];
        if (!validCategories.includes(category)) {
            return errorResponse(res, 'Invalid category', 400);
        }

        // Get signing account
        const signer = getSigner();
        
        // Generate a mock proposal ID (in practice this would come from the contract)
        const proposalId = `0x${Date.now().toString(16).padStart(64, '0')}`;
        
        // Get current block numbers (simplified)
        const startBlock = 0; // Would come from provider
        const endBlock = 0;   // Would come from provider

        const proposal = await governanceService.createProposal({
            title,
            description,
            category,
            proposerWallet,
            targetContract,
            calldata,
            value: value || 0,
            proposalId,
            startBlock,
            endBlock,
            txHash: null
        });

        res.status(201).json({
            success: true,
            message: 'Proposal created successfully',
            proposal
        });
    } catch (error) {
        console.error('Error creating proposal:', error);
        return errorResponse(res, error.message, 500);
    }
});

/**
 * POST /api/governance/vote
 * Cast a vote on a proposal
 */
router.post('/vote', async (req, res) => {
    try {
        const { proposalId, support, txHash } = req.body;
        const voterWallet = req.user.wallet_address;

        // Validate required fields
        if (!proposalId || support === undefined) {
            return errorResponse(res, 'proposalId and support are required', 400);
        }

        // Verify proposal exists and is active
        const proposal = await governanceService.getProposal(proposalId);
        if (!proposal) {
            return errorResponse(res, 'Proposal not found', 404);
        }

        if (proposal.status !== 'ACTIVE') {
            return errorResponse(res, 'Proposal is not active for voting', 400);
        }

        // Get voting power (simplified - in practice would query the token contract)
        const votingPower = await governanceService.getVotingPower(voterWallet);
        const voteWeight = BigInt(votingPower.votes || 0);

        if (voteWeight === 0n) {
            return errorResponse(res, 'No voting power', 400);
        }

        const result = await governanceService.castVote({
            proposalId,
            voterWallet,
            support,
            voteWeight: voteWeight.toString(),
            txHash,
            blockNumber: null
        });

        res.json({
            success: true,
            message: 'Vote cast successfully',
            ...result
        });
    } catch (error) {
        console.error('Error casting vote:', error);
        return errorResponse(res, error.message, 500);
    }
});

/**
 * GET /api/governance/parameters
 * Get all governance parameters
 */
router.get('/parameters', async (req, res) => {
    try {
        const parameters = await governanceService.getParameters();

        res.json({
            success: true,
            parameters
        });
    } catch (error) {
        console.error('Error fetching parameters:', error);
        return errorResponse(res, error.message, 500);
    }
});

/**
 * PUT /api/governance/parameters/:name
 * Update a governance parameter (admin only)
 */
router.put('/parameters/:name', requireRole(['admin']), async (req, res) => {
    try {
        const { name } = req.params;
        const { value } = req.body;

        if (!value) {
            return errorResponse(res, 'Parameter value is required', 400);
        }

        const updated = await governanceService.updateParameter(
            name,
            value,
            req.user.wallet_address
        );

        res.json({
            success: true,
            message: 'Parameter updated successfully',
            parameter: updated
        });
    } catch (error) {
        console.error('Error updating parameter:', error);
        return errorResponse(res, error.message, 500);
    }
});

/**
 * GET /api/governance/delegation/:wallet
 * Get delegation info for a wallet
 */
router.get('/delegation/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        
        const delegation = await governanceService.getDelegation(wallet);

        res.json({
            success: true,
            delegation
        });
    } catch (error) {
        console.error('Error fetching delegation:', error);
        return errorResponse(res, error.message, 500);
    }
});

/**
 * GET /api/governance/voting-power/:wallet
 * Get voting power for a wallet
 */
router.get('/voting-power/:wallet', async (req, res) => {
    try {
        const { wallet } = req.params;
        
        const votingPower = await governanceService.getVotingPower(wallet);

        res.json({
            success: true,
            votingPower
        });
    } catch (error) {
        console.error('Error fetching voting power:', error);
        return errorResponse(res, error.message, 500);
    }
});

/**
 * GET /api/governance/stats
 * Get proposal statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = await governanceService.getProposalStats();

        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        return errorResponse(res, error.message, 500);
    }
});

/**
 * POST /api/governance/execute
 * Execute a queued parameter change
 */
router.post('/execute', requireRole(['admin']), async (req, res) => {
    try {
        const { parameterName } = req.body;

        if (!parameterName) {
            return errorResponse(res, 'parameterName is required', 400);
        }

        const result = await governanceService.executeParameterChange(parameterName);

        res.json({
            success: true,
            message: 'Parameter change executed successfully',
            ...result
        });
    } catch (error) {
        console.error('Error executing parameter change:', error);
        return errorResponse(res, error.message, 500);
    }
});

module.exports = router;

