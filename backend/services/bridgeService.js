const { ethers } = require('ethers');
const logger = require('../utils/logger')('bridgeService');
// 1. Import the shared signer from your central blockchain config
const { getSigner } = require('../config/blockchain');

const extractAbi = (artifact) => {
  return artifact.abi || (artifact.interface && artifact.interface.fragments) || artifact;
};

// Import ABIs (assuming they are compiled and available)
const BridgeAdapterABI = extractAbi(require('../../deployed/BridgeAdapter.json'));
const LiquidityAdapterABI = extractAbi(require('../../deployed/LiquidityAdapter.json'));
const FinancingManagerABI = extractAbi(require('../../deployed/FinancingManager.json'));
const contractAddresses = require('../../deployed/contract-addresses.json');

// Assuming these are deployed addresses; in real setup, fetch from config or DB
const BRIDGE_ADAPTER_ADDRESS = contractAddresses.BridgeAdapter;
const LIQUIDITY_ADAPTER_ADDRESS = contractAddresses.LiquidityAdapter;
const FINANCING_MANAGER_ADDRESS = contractAddresses.FinancingManagerProxy;

// Contract instances
let bridgeAdapter, liquidityAdapter, financingManager;

// 2. Update all getters to use the shared signer
const getBridgeAdapter = () => {
    if (!bridgeAdapter) {
        if (!BRIDGE_ADAPTER_ADDRESS) throw new BridgeServiceError('BRIDGE_ADAPTER_ADDRESS not set');
        const signer = getSigner();
        bridgeAdapter = new ethers.Contract(BRIDGE_ADAPTER_ADDRESS, BridgeAdapterABI, signer);
    }
    return bridgeAdapter;
};

const getLiquidityAdapter = () => {
    if (!liquidityAdapter) {
        if (!LIQUIDITY_ADAPTER_ADDRESS) throw new BridgeServiceError('LIQUIDITY_ADAPTER_ADDRESS not set');
        const signer = getSigner();
        liquidityAdapter = new ethers.Contract(LIQUIDITY_ADAPTER_ADDRESS, LiquidityAdapterABI, signer);
    }
    return liquidityAdapter;
};

const getFinancingManager = () => {
    if (!financingManager) {
        if (!FINANCING_MANAGER_ADDRESS) throw new BridgeServiceError('FINANCING_MANAGER_ADDRESS not set');
        const signer = getSigner();
        financingManager = new ethers.Contract(FINANCING_MANAGER_ADDRESS, FinancingManagerABI, signer);
    }
    return financingManager;
};

// Supported assets (stablecoins)
const ASSETS = {
    USDC: process.env.USDC_ADDRESS,
    EURC: process.env.EURC_ADDRESS,
    BRLC: process.env.BRLC_ADDRESS,
};

/**
 * Custom error class for bridge service errors
 */
class BridgeServiceError extends Error {
    constructor(message, code, originalError = null) {
        super(message);
        this.name = 'BridgeServiceError';
        this.code = code;
        this.originalError = originalError;
    }
}

/**
 * Helper function to handle blockchain errors
 */
function handleBlockchainError(error, operation) {
    const errorMessage = error.message || String(error);
    
    if (errorMessage.includes('insufficient funds')) {
        throw new BridgeServiceError(
            'Insufficient funds for transaction. Please ensure you have enough balance.',
            'INSUFFICIENT_FUNDS',
            error
        );
    }
    
    if (errorMessage.includes('nonce')) {
        throw new BridgeServiceError(
            'Transaction nonce error. Please try again.',
            'NONCE_ERROR',
            error
        );
    }
    
    if (errorMessage.includes('gas')) {
        throw new BridgeServiceError(
            'Insufficient gas for transaction. Please try again with more gas.',
            'GAS_ERROR',
            error
        );
    }
    
    if (errorMessage.includes('user rejected')) {
        throw new BridgeServiceError(
            'Transaction was rejected by user.',
            'USER_REJECTED',
            error
        );
    }
    
    if (errorMessage.includes('transaction reverted')) {
        throw new BridgeServiceError(
            `Transaction reverted during ${operation}. Please check the contract state.`,
            'TRANSACTION_REVERTED',
            error
        );
    }
    
    // Generic error
    throw new BridgeServiceError(
        `Failed to ${operation}. Please try again later.`,
        'UNKNOWN_ERROR',
        error
    );
}

/**
 * Bridge collateral to Katana (if needed)
 */
async function bridgeToKatana(collateralTokenId, amount, userId) {
    try {
        // Assuming collateral is FractionToken
        const fractionTokenAddress = require('../../deployed/contract-addresses.json').FractionToken;
        
        if (!fractionTokenAddress) {
            throw new BridgeServiceError(
                'FractionToken address not configured',
                'CONFIG_ERROR'
            );
        }
        
        const katanaChain = ethers.keccak256(ethers.toUtf8Bytes("katana"));
        
        logger.info(`[BridgeService] Locking ERC1155 for bridge: tokenId=${collateralTokenId}, amount=${amount}`);
        
        const lockTx = await getBridgeAdapter().lockERC1155ForBridge(
            fractionTokenAddress, 
            collateralTokenId, 
            amount, 
            katanaChain
        );
        
        logger.info(`[BridgeService] Lock transaction sent: ${lockTx.hash}`);
        const lockReceipt = await lockTx.wait();
        
        logger.info(`[BridgeService] Lock confirmed, bridging asset...`);
        
        const bridgeTx = await getBridgeAdapter().bridgeERC1155Asset(
            lockTx.hash, 
            LIQUIDITY_ADAPTER_ADDRESS
        );
        
        logger.info(`[BridgeService] Bridge transaction sent: ${bridgeTx.hash}`);
        const bridgeReceipt = await bridgeTx.wait();
        
        logger.info(`[BridgeService] Bridge completed successfully`);
        
        return { 
            lockId: lockTx.hash,
            lockTxHash: lockTx.hash,
            bridgeTxHash: bridgeTx.hash,
            blockNumber: bridgeReceipt.blockNumber
        };
        
    } catch (error) {
        if (error instanceof BridgeServiceError) {
            throw error;
        }
        console.error('[BridgeService] Error bridging to Katana:', error);
        logger.error('[BridgeService] Error bridging to Katana:', error);
        handleBlockchainError(error, 'bridge collateral to Katana');
    }
}

/**
 * Borrow from Katana liquidity pool
 */
async function borrowFromKatana(asset, amount, collateralTokenId) {
    try {
        const assetAddress = ASSETS[asset];
        
        if (!assetAddress) {
            throw new BridgeServiceError(
                `Unsupported asset: ${asset}. Supported assets: ${Object.keys(ASSETS).join(', ')}`,
                'UNSUPPORTED_ASSET'
            );
        }
        
        if (!amount || amount <= 0) {
            throw new BridgeServiceError(
                'Invalid amount. Amount must be greater than 0.',
                'INVALID_AMOUNT'
            );
        }
        
        if (!collateralTokenId) {
            throw new BridgeServiceError(
                'Collateral token ID is required.',
                'MISSING_COLLATERAL'
            );
        }
        
        logger.info(`[BridgeService] Borrowing from Katana: asset=${asset}, amount=${amount}, collateral=${collateralTokenId}`);
        
        // First, bridge collateral if not already done
        const bridgeResult = await bridgeToKatana(collateralTokenId, amount, 'user');
        
        logger.info(`[BridgeService] Borrowing from pool: assetAddress=${assetAddress}, amount=${amount}`);
        
        // 3. Update the borrowing logic to get the address from the shared signer dynamically
        const signer = getSigner();
        const borrowTx = await getLiquidityAdapter().borrowFromPool(
            assetAddress, 
            amount, 
            signer.address
        );
        
        logger.info(`[BridgeService] Borrow transaction sent: ${borrowTx.hash}`);
        const receipt = await borrowTx.wait();
        
        logger.info(`[BridgeService] Borrow completed successfully`);
        
        return { 
            loanId: borrowTx.hash,
            txHash: borrowTx.hash,
            blockNumber: receipt.blockNumber,
            bridgeResult
        };
        
    } catch (error) {
        if (error instanceof BridgeServiceError) {
            throw error;
        }
        logger.error('[BridgeService] Error borrowing from Katana:', error);
        handleBlockchainError(error, 'borrow from Katana');
    }
}

/**
 * Get liquidity rates for an asset
 */
async function getLiquidityRates(asset) {
    try {
        const assetAddress = ASSETS[asset];
        
        if (!assetAddress) {
            throw new BridgeServiceError(
                `Unsupported asset: ${asset}. Supported assets: ${Object.keys(ASSETS).join(', ')}`,
                'UNSUPPORTED_ASSET'
            );
        }
        
        logger.info(`[BridgeService] Getting liquidity rates for: ${asset}`);
        
        const borrowRate = await getLiquidityAdapter().getBorrowRate(assetAddress);
        const availableLiquidity = await getLiquidityAdapter().getAvailableLiquidity(assetAddress);
        
        return {
            borrowRate: borrowRate.toString(),
            availableLiquidity: availableLiquidity.toString(),
            asset,
            assetAddress
        };
        
    } catch (error) {
        if (error instanceof BridgeServiceError) {
            throw error;
        }
        logger.error('[BridgeService] Error getting liquidity rates:', error);
        handleBlockchainError(error, 'get liquidity rates');
    }
}

/**
 * Repay to Katana liquidity pool
 */
async function repayToKatana(asset, amount, loanId) {
    try {
        const assetAddress = ASSETS[asset];
        
        if (!assetAddress) {
            throw new BridgeServiceError(
                `Unsupported asset: ${asset}. Supported assets: ${Object.keys(ASSETS).join(', ')}`,
                'UNSUPPORTED_ASSET'
            );
        }
        
        if (!amount || amount <= 0) {
            throw new BridgeServiceError(
                'Invalid amount. Amount must be greater than 0.',
                'INVALID_AMOUNT'
            );
        }
        
        if (!loanId) {
            throw new BridgeServiceError(
                'Loan ID is required for repayment.',
                'MISSING_LOAN_ID'
            );
        }
        
        logger.info(`[BridgeService] Repaying to Katana: asset=${asset}, amount=${amount}, loanId=${loanId}`);
        
        // Repay the loan
        const repayTx = await getLiquidityAdapter().repayToPool(loanId);
        
        logger.info(`[BridgeService] Repay transaction sent: ${repayTx.hash}`);
        const receipt = await repayTx.wait();
        
        logger.info(`[BridgeService] Repay completed successfully`);
        
        return { 
            success: true,
            txHash: repayTx.hash,
            blockNumber: receipt.blockNumber,
            amount,
            asset
        };
        
    } catch (error) {
        if (error instanceof BridgeServiceError) {
            throw error;
        }
        logger.error('[BridgeService] Error repaying to Katana:', error);
        handleBlockchainError(error, 'repay to Katana');
    }
}

module.exports = {
    bridgeToKatana,
    borrowFromKatana,
    getLiquidityRates,
    repayToKatana,
    BridgeServiceError
};