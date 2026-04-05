const { ethers } = require('ethers');
const { CrossChainFraction, CrossChainMarketplaceListing, CrossChainTrade } = require('../models/CrossChainFraction');

// Import ABIs
const FractionTokenABI = require('../../deployed/FractionToken.json').abi;

// Contract addresses (from environment)
const FRACTION_TOKEN_ADDRESS = process.env.FRACTION_TOKEN_ADDRESS;

// Supported chains
const SUPPORTED_CHAINS = {
    'finovate-cdk': 'FinovatePay CDK',
    'katana': 'Katana',
    'polygon-pos': 'Polygon PoS',
    'polygon-zkevm': 'Polygon zkEVM'
};

// Chain IDs for different networks
const CHAIN_IDS = {
    'finovate-cdk': process.env.FINOVATE_CHAIN_ID || '1001',
    'katana': '51000',
    'polygon-pos': '137',
    'polygon-zkevm': '1101'
};

class CrossChainServiceError extends Error {
    constructor(message, code, originalError = null) {
        super(message);
        this.name = 'CrossChainServiceError';
        this.code = code;
        this.originalError = originalError;
    }
}

/**
 * Get provider for a specific chain
 */
function getProviderForChain(chain) {
    const rpcUrl = process.env[`${chain.toUpperCase()}_RPC_URL`] || process.env.RPC_URL;
    if (!rpcUrl) {
        throw new CrossChainServiceError(`No RPC URL configured for chain: ${chain}`, 'CONFIG_ERROR');
    }
    return new ethers.JsonRpcProvider(rpcUrl);
}

/**
 * Get signer for a specific chain
 */
function getSignerForChain(chain) {
    const provider = getProviderForChain(chain);
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) {
        throw new CrossChainServiceError('No deployer private key configured', 'CONFIG_ERROR');
    }
    return new ethers.Wallet(privateKey, provider);
}

/**
 * Bridge fractions to another chain
 */
async function bridgeFractionsToChain(data) {
    const {
        tokenId,
        invoiceId,
        ownerId,
        ownerWallet,
        amount,
        destinationChain,
        pricePerFraction
    } = data;

    try {
        // Validate destination chain
        if (!SUPPORTED_CHAINS[destinationChain]) {
            throw new CrossChainServiceError(
                `Unsupported destination chain: ${destinationChain}`,
                'UNSUPPORTED_CHAIN'
            );
        }

        if (destinationChain === 'finovate-cdk') {
            throw new CrossChainServiceError(
                'Cannot bridge to the same chain',
                'INVALID_CHAIN'
            );
        }

        // Get signer
        const signer = getSignerForChain('finovate-cdk');
        
        // Get FractionToken contract
        const fractionToken = new ethers.Contract(
            FRACTION_TOKEN_ADDRESS,
            FractionTokenABI,
            signer
        );

        // Approve tokens for bridging (if needed)
        // Note: In production, this would check and set approval

        // Calculate lockId (simulated - actual would come from bridge)
        const lockId = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['uint256', 'address', 'uint256', 'bytes32', 'uint256'],
                [tokenId, ownerWallet, amount, ethers.zeroPadValue(ethers.toUtf8Bytes(destinationChain), 32), Date.now()]
            )
        );

        // Call bridgeOut on FractionToken
        const destinationChainBytes32 = ethers.keccak256(ethers.toUtf8Bytes(destinationChain));
        
        // Note: This would typically be done via BridgeAdapter
        // For now, we simulate the bridge operation
        const bridgeTx = await fractionToken.bridgeOut(
            tokenId,
            amount,
            destinationChainBytes32,
            ownerWallet,
            lockId
        );

        const receipt = await bridgeTx.wait();

        // Record in database
        const crossChainFraction = await CrossChainFraction.create({
            tokenId: tokenId.toString(),
            invoiceId,
            ownerId,
            ownerWallet,
            amount: amount.toString(),
            destinationChain,
            sourceChain: 'finovate-cdk',
            bridgeLockId: lockId,
            bridgeTxHash: bridgeTx.hash,
            status: 'bridged',
            pricePerFraction
        });

        return {
            success: true,
            transactionHash: bridgeTx.hash,
            lockId,
            crossChainFraction,
            destinationChain,
            amount: amount.toString()
        };

    } catch (error) {
        if (error instanceof CrossChainServiceError) {
            throw error;
        }
        console.error('[CrossChainService] Error bridging fractions:', error);
        throw new CrossChainServiceError(
            'Failed to bridge fractions',
            'BRIDGE_ERROR',
            error
        );
    }
}

/**
 * Create a cross-chain marketplace listing
 */
async function createCrossChainListing(data) {
    const {
        tokenId,
        invoiceId,
        sellerId,
        sellerWallet,
        amount,
        pricePerFraction,
        destinationChain,
        expiresAt
    } = data;

    try {
        // Validate destination chain
        if (!SUPPORTED_CHAINS[destinationChain]) {
            throw new CrossChainServiceError(
                `Unsupported destination chain: ${destinationChain}`,
                'UNSUPPORTED_CHAIN'
            );
        }

        // First bridge the fractions
        const bridgeResult = await bridgeFractionsToChain({
            tokenId,
            invoiceId,
            ownerId: sellerId,
            ownerWallet: sellerWallet,
            amount,
            destinationChain,
            pricePerFraction
        });

        // Create marketplace listing
        const listing = await CrossChainMarketplaceListing.create({
            tokenId: tokenId.toString(),
            invoiceId,
            sellerId,
            sellerWallet,
            amount: amount.toString(),
            pricePerFraction,
            destinationChain,
            sourceChain: 'finovate-cdk',
            expiresAt
        });

        return {
            success: true,
            listing,
            bridgeResult
        };

    } catch (error) {
        if (error instanceof CrossChainServiceError) {
            throw error;
        }
        console.error('[CrossChainService] Error creating cross-chain listing:', error);
        throw new CrossChainServiceError(
            'Failed to create cross-chain listing',
            'LISTING_ERROR',
            error
        );
    }
}

/**
 * Get cross-chain marketplace listings
 */
async function getMarketplaceListings(destinationChain = null) {
    try {
        if (destinationChain) {
            if (!SUPPORTED_CHAINS[destinationChain]) {
                throw new CrossChainServiceError(
                    `Unsupported chain: ${destinationChain}`,
                    'UNSUPPORTED_CHAIN'
                );
            }
            return await CrossChainMarketplaceListing.findActiveByChain(destinationChain);
        }
        
        // Return all active listings grouped by chain
        const chains = Object.keys(SUPPORTED_CHAINS).filter(c => c !== 'finovate-cdk');
        const listings = {};
        
        for (const chain of chains) {
            listings[chain] = await CrossChainMarketplaceListing.findActiveByChain(chain);
        }
        
        return listings;

    } catch (error) {
        if (error instanceof CrossChainServiceError) {
            throw error;
        }
        console.error('[CrossChainService] Error getting marketplace listings:', error);
        throw new CrossChainServiceError(
            'Failed to get marketplace listings',
            'LISTING_ERROR',
            error
        );
    }
}

/**
 * Execute a cross-chain trade
 */
async function executeCrossChainTrade(data) {
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
        destinationChain,
        tradeTxHash
    } = data;

    try {
        const totalPrice = BigInt(amount) * BigInt(pricePerFraction);
        
        // Create trade record
        const trade = await CrossChainTrade.create({
            listingId,
            tokenId: tokenId.toString(),
            invoiceId,
            sellerId,
            buyerId,
            sellerWallet,
            buyerWallet,
            amount: amount.toString(),
            pricePerFraction: pricePerFraction.toString(),
            totalPrice: totalPrice.toString(),
            destinationChain,
            tradeTxHash,
            status: 'completed'
        });

        // Update listing
        await CrossChainMarketplaceListing.updateAfterTrade(listingId, amount);

        return {
            success: true,
            trade,
            totalPrice: totalPrice.toString()
        };

    } catch (error) {
        if (error instanceof CrossChainServiceError) {
            throw error;
        }
        console.error('[CrossChainService] Error executing cross-chain trade:', error);
        throw new CrossChainServiceError(
            'Failed to execute cross-chain trade',
            'TRADE_ERROR',
            error
        );
    }
}

/**
 * Return fractions from cross-chain back to origin chain
 */
async function returnFractionsFromChain(data) {
    const {
        tokenId,
        ownerId,
        ownerWallet,
        amount,
        sourceChain
    } = data;

    try {
        // Validate source chain
        if (!SUPPORTED_CHAINS[sourceChain]) {
            throw new CrossChainServiceError(
                `Unsupported source chain: ${sourceChain}`,
                'UNSUPPORTED_CHAIN'
            );
        }

        if (sourceChain === 'finovate-cdk') {
            throw new CrossChainServiceError(
                'Cannot return from the same chain',
                'INVALID_CHAIN'
            );
        }

        // Get signer
        const signer = getSignerForChain('finovate-cdk');
        
        // Get FractionToken contract
        const fractionToken = new ethers.Contract(
            FRACTION_TOKEN_ADDRESS,
            FractionTokenABI,
            signer
        );

        // Calculate return lockId
        const returnLockId = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['uint256', 'address', 'uint256', 'bytes32', 'uint256'],
                [tokenId, ownerWallet, amount, ethers.zeroPadValue(ethers.toUtf8Bytes(sourceChain), 32), Date.now()]
            )
        );

        // Call bridgeIn on FractionToken
        const sourceChainBytes32 = ethers.keccak256(ethers.toUtf8Bytes(sourceChain));
        
        const returnTx = await fractionToken.bridgeIn(
            tokenId,
            amount,
            ownerWallet,
            sourceChainBytes32
        );

        const receipt = await returnTx.wait();

        return {
            success: true,
            transactionHash: returnTx.hash,
            returnLockId,
            sourceChain,
            amount: amount.toString()
        };

    } catch (error) {
        if (error instanceof CrossChainServiceError) {
            throw error;
        }
        console.error('[CrossChainService] Error returning fractions:', error);
        throw new CrossChainServiceError(
            'Failed to return fractions from cross-chain',
            'RETURN_ERROR',
            error
        );
    }
}

/**
 * Get user's cross-chain fractions
 */
async function getUserCrossChainFractions(userId) {
    try {
        return await CrossChainFraction.findByOwner(userId);
    } catch (error) {
        console.error('[CrossChainService] Error getting user cross-chain fractions:', error);
        throw new CrossChainServiceError(
            'Failed to get user cross-chain fractions',
            'FETCH_ERROR',
            error
        );
    }
}

/**
 * Get user's cross-chain listings
 */
async function getUserListings(sellerId) {
    try {
        return await CrossChainMarketplaceListing.findBySeller(sellerId);
    } catch (error) {
        console.error('[CrossChainService] Error getting user listings:', error);
        throw new CrossChainServiceError(
            'Failed to get user listings',
            'FETCH_ERROR',
            error
        );
    }
}

/**
 * Get user's cross-chain trades
 */
async function getUserTrades(userId) {
    try {
        const [bought, sold] = await Promise.all([
            CrossChainTrade.findByBuyer(userId),
            CrossChainTrade.findBySeller(userId)
        ]);
        
        return { bought, sold };
    } catch (error) {
        console.error('[CrossChainService] Error getting user trades:', error);
        throw new CrossChainServiceError(
            'Failed to get user trades',
            'FETCH_ERROR',
            error
        );
    }
}

/**
 * Get supported chains
 */
function getSupportedChains() {
    return SUPPORTED_CHAINS;
}

/**
 * Get chain ID for a chain name
 */
function getChainId(chain) {
    return CHAIN_IDS[chain] || null;
}

module.exports = {
    bridgeFractionsToChain,
    createCrossChainListing,
    getMarketplaceListings,
    executeCrossChainTrade,
    returnFractionsFromChain,
    getUserCrossChainFractions,
    getUserListings,
    getUserTrades,
    getSupportedChains,
    getChainId,
    CrossChainServiceError,
    SUPPORTED_CHAINS,
    CHAIN_IDS
};
