const express = require('express');
const router = express.Router();
const crossChainService = require('../services/crossChainService');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const { pool } = require('../config/database');
const { logAudit } = require('../middleware/auditLogger');

/**
 * GET /api/crosschain/chains
 * Get supported chains for cross-chain operations
 */
router.get('/chains', authenticateToken, async (req, res) => {
    try {
        const chains = crossChainService.getSupportedChains();
        const chainIds = {};
        
        Object.keys(chains).forEach(chain => {
            chainIds[chain] = crossChainService.getChainId(chain);
        });

        res.json({
            success: true,
            chains,
            chainIds
        });
    } catch (error) {
        console.error('Error getting supported chains:', error);
        res.status(500).json({ error: 'Failed to get supported chains' });
    }
});

/**
 * GET /api/crosschain/marketplace
 * Get cross-chain marketplace listings
 */
router.get('/marketplace', authenticateToken, async (req, res) => {
    try {
        const { chain } = req.query;
        const listings = await crossChainService.getMarketplaceListings(chain);
        
        res.json({
            success: true,
            listings
        });
    } catch (error) {
        console.error('Error getting marketplace listings:', error);
        res.status(500).json({ error: 'Failed to get marketplace listings' });
    }
});

/**
 * POST /api/crosschain/bridge
 * Bridge fractions to another chain
 */
router.post('/bridge', authenticateToken, requireRole(['seller', 'investor']), requireKYC, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { tokenId, invoiceId, amount, destinationChain, pricePerFraction } = req.body;
        const userId = req.user.id;

        if (!tokenId || !invoiceId || !amount || !destinationChain) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate invoice ownership
        const invoiceQuery = await client.query(
            'SELECT * FROM invoices WHERE invoice_id = $1 AND (seller_id = $2 OR buyer_id = $2)',
            [invoiceId, userId]
        );

        if (invoiceQuery.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found or unauthorized' });
        }

        await client.query('BEGIN');

        // Bridge fractions
        const result = await crossChainService.bridgeFractionsToChain({
            tokenId: parseInt(tokenId),
            invoiceId,
            ownerId: userId,
            ownerWallet: req.user.wallet_address,
            amount: BigInt(amount),
            destinationChain,
            pricePerFraction: pricePerFraction ? BigInt(pricePerFraction) : null
        });

        await client.query('COMMIT');

        // Log audit
        await logAudit({
            operationType: 'CROSS_CHAIN_BRIDGE',
            entityType: 'INVOICE_FRACTION',
            entityId: invoiceId,
            actorId: userId,
            actorWallet: req.user.wallet_address,
            actorRole: req.user.role,
            action: 'BRIDGE_FRACTIONS',
            status: 'SUCCESS',
            newValues: { tokenId, amount, destinationChain },
            metadata: result,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.json({
            success: true,
            message: 'Fractions bridged successfully',
            ...result
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error bridging fractions:', error);

        await logAudit({
            operationType: 'CROSS_CHAIN_BRIDGE',
            entityType: 'INVOICE_FRACTION',
            entityId: req.body.invoiceId,
            actorId: req.user?.id,
            actorWallet: req.user?.wallet_address,
            actorRole: req.user?.role,
            action: 'BRIDGE_FRACTIONS',
            status: 'FAILED',
            errorMessage: error.message,
            metadata: req.body,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.status(500).json({ error: error.message || 'Failed to bridge fractions' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/crosschain/list
 * Create a cross-chain marketplace listing
 */
router.post('/list', authenticateToken, requireRole(['seller', 'investor']), requireKYC, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { tokenId, invoiceId, amount, pricePerFraction, destinationChain, expiresAt } = req.body;
        const userId = req.user.id;

        if (!tokenId || !invoiceId || !amount || !pricePerFraction || !destinationChain) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate invoice ownership
        const invoiceQuery = await client.query(
            'SELECT * FROM invoices WHERE invoice_id = $1 AND seller_id = $2',
            [invoiceId, userId]
        );

        if (invoiceQuery.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found or unauthorized' });
        }

        await client.query('BEGIN');

        // Create listing
        const result = await crossChainService.createCrossChainListing({
            tokenId: parseInt(tokenId),
            invoiceId,
            sellerId: userId,
            sellerWallet: req.user.wallet_address,
            amount: BigInt(amount),
            pricePerFraction: BigInt(pricePerFraction),
            destinationChain,
            expiresAt
        });

        // Update invoice to enable cross-chain
        await client.query(
            'UPDATE invoices SET cross_chain_enabled = true, updated_at = NOW() WHERE invoice_id = $1',
            [invoiceId]
        );

        await client.query('COMMIT');

        // Log audit
        await logAudit({
            operationType: 'CROSS_CHAIN_LISTING',
            entityType: 'INVOICE_FRACTION',
            entityId: invoiceId,
            actorId: userId,
            actorWallet: req.user.wallet_address,
            actorRole: req.user.role,
            action: 'CREATE_LISTING',
            status: 'SUCCESS',
            newValues: { tokenId, amount, pricePerFraction, destinationChain },
            metadata: result,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.json({
            success: true,
            message: 'Cross-chain listing created successfully',
            ...result
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating cross-chain listing:', error);

        await logAudit({
            operationType: 'CROSS_CHAIN_LISTING',
            entityType: 'INVOICE_FRACTION',
            entityId: req.body.invoiceId,
            actorId: req.user?.id,
            actorWallet: req.user?.wallet_address,
            actorRole: req.user?.role,
            action: 'CREATE_LISTING',
            status: 'FAILED',
            errorMessage: error.message,
            metadata: req.body,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.status(500).json({ error: error.message || 'Failed to create cross-chain listing' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/crosschain/trade
 * Execute a cross-chain trade (buy fractions on another chain)
 */
router.post('/trade', authenticateToken, requireRole(['buyer', 'investor']), requireKYC, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { listingId, amount } = req.body;
        const userId = req.user.id;

        if (!listingId || !amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Get listing
        const listing = await crossChainService.getMarketplaceListings();
        let foundListing = null;
        
        // Search for listing across all chains
        for (const chainListings of Object.values(listing)) {
            foundListing = chainListings.find(l => l.id === parseInt(listingId));
            if (foundListing) break;
        }

        if (!foundListing) {
            return res.status(404).json({ error: 'Listing not found' });
        }

        if (foundListing.listing_status !== 'active') {
            return res.status(400).json({ error: 'Listing is not active' });
        }

        if (BigInt(amount) > BigInt(foundListing.remaining_amount)) {
            return res.status(400).json({ error: 'Amount exceeds available supply' });
        }

        await client.query('BEGIN');

        // Execute trade
        const result = await crossChainService.executeCrossChainTrade({
            listingId: parseInt(listingId),
            tokenId: parseInt(foundListing.token_id),
            invoiceId: foundListing.invoice_id,
            sellerId: foundListing.seller_id,
            buyerId: userId,
            sellerWallet: foundListing.seller_wallet,
            buyerWallet: req.user.wallet_address,
            amount: BigInt(amount),
            pricePerFraction: BigInt(foundListing.price_per_fraction),
            destinationChain: foundListing.destination_chain,
            tradeTxHash: `0x${Math.random().toString(16).substr(2, 64)}` // Simulated tx hash
        });

        await client.query('COMMIT');

        // Log audit
        await logAudit({
            operationType: 'CROSS_CHAIN_TRADE',
            entityType: 'INVOICE_FRACTION',
            entityId: foundListing.invoice_id,
            actorId: userId,
            actorWallet: req.user.wallet_address,
            actorRole: req.user.role,
            action: 'EXECUTE_TRADE',
            status: 'SUCCESS',
            newValues: { listingId, amount, totalPrice: result.totalPrice },
            metadata: result,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.json({
            success: true,
            message: 'Cross-chain trade executed successfully',
            ...result
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error executing cross-chain trade:', error);

        await logAudit({
            operationType: 'CROSS_CHAIN_TRADE',
            entityType: 'INVOICE_FRACTION',
            entityId: req.body.listingId,
            actorId: req.user?.id,
            actorWallet: req.user?.wallet_address,
            actorRole: req.user?.role,
            action: 'EXECUTE_TRADE',
            status: 'FAILED',
            errorMessage: error.message,
            metadata: req.body,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.status(500).json({ error: error.message || 'Failed to execute cross-chain trade' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/crosschain/return
 * Return fractions from cross-chain back to origin chain
 */
router.post('/return', authenticateToken, requireRole(['seller', 'investor']), requireKYC, async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { tokenId, invoiceId, amount, sourceChain } = req.body;
        const userId = req.user.id;

        if (!tokenId || !invoiceId || !amount || !sourceChain) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        await client.query('BEGIN');

        // Return fractions
        const result = await crossChainService.returnFractionsFromChain({
            tokenId: parseInt(tokenId),
            ownerId: userId,
            ownerWallet: req.user.wallet_address,
            amount: BigInt(amount),
            sourceChain
        });

        await client.query('COMMIT');

        // Log audit
        await logAudit({
            operationType: 'CROSS_CHAIN_RETURN',
            entityType: 'INVOICE_FRACTION',
            entityId: invoiceId,
            actorId: userId,
            actorWallet: req.user.wallet_address,
            actorRole: req.user.role,
            action: 'RETURN_FRACTIONS',
            status: 'SUCCESS',
            newValues: { tokenId, amount, sourceChain },
            metadata: result,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.json({
            success: true,
            message: 'Fractions returned successfully',
            ...result
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error returning fractions:', error);

        await logAudit({
            operationType: 'CROSS_CHAIN_RETURN',
            entityType: 'INVOICE_FRACTION',
            entityId: req.body.invoiceId,
            actorId: req.user?.id,
            actorWallet: req.user?.wallet_address,
            actorRole: req.user?.role,
            action: 'RETURN_FRACTIONS',
            status: 'FAILED',
            errorMessage: error.message,
            metadata: req.body,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.status(500).json({ error: error.message || 'Failed to return fractions' });
    } finally {
        client.release();
    }
});

/**
 * GET /api/crosschain/my-fractions
 * Get user's cross-chain fractions
 */
router.get('/my-fractions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const fractions = await crossChainService.getUserCrossChainFractions(userId);
        
        res.json({
            success: true,
            fractions
        });
    } catch (error) {
        console.error('Error getting user fractions:', error);
        res.status(500).json({ error: 'Failed to get user fractions' });
    }
});

/**
 * GET /api/crosschain/my-listings
 * Get user's cross-chain listings
 */
router.get('/my-listings', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const listings = await crossChainService.getUserListings(userId);
        
        res.json({
            success: true,
            listings
        });
    } catch (error) {
        console.error('Error getting user listings:', error);
        res.status(500).json({ error: 'Failed to get user listings' });
    }
});

/**
 * GET /api/crosschain/my-trades
 * Get user's cross-chain trades
 */
router.get('/my-trades', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const trades = await crossChainService.getUserTrades(userId);
        
        res.json({
            success: true,
            ...trades
        });
    } catch (error) {
        console.error('Error getting user trades:', error);
        res.status(500).json({ error: 'Failed to get user trades' });
    }
});

module.exports = router;
