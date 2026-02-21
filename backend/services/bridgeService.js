const { ethers } = require('ethers');

// Import ABIs (assuming they are compiled and available)
const BridgeAdapterABI = require('../../deployed/BridgeAdapter.json').abi;
const LiquidityAdapterABI = require('../../deployed/LiquidityAdapter.json').abi;
const FinancingManagerABI = require('../../deployed/FinancingManager.json').abi;

// Assuming these are deployed addresses; in real setup, fetch from config or DB
const BRIDGE_ADAPTER_ADDRESS = process.env.BRIDGE_ADAPTER_ADDRESS;
const LIQUIDITY_ADAPTER_ADDRESS = process.env.LIQUIDITY_ADAPTER_ADDRESS;
const FINANCING_MANAGER_ADDRESS = process.env.FINANCING_MANAGER_ADDRESS;

// Provider and signer setup (use environment variables for RPC URL, private key)
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

// Contract instances
let bridgeAdapter, liquidityAdapter, financingManager;

const getBridgeAdapter = () => {
    if (!bridgeAdapter) {
        if (!BRIDGE_ADAPTER_ADDRESS) throw new BridgeServiceError('BRIDGE_ADAPTER_ADDRESS not set');
        bridgeAdapter = new ethers.Contract(BRIDGE_ADAPTER_ADDRESS, BridgeAdapterABI, signer);
    }
    return bridgeAdapter;
};

const getLiquidityAdapter = () => {
    if (!liquidityAdapter) {
        if (!LIQUIDITY_ADAPTER_ADDRESS) throw new BridgeServiceError('LIQUIDITY_ADAPTER_ADDRESS not set');
        liquidityAdapter = new ethers.Contract(LIQUIDITY_ADAPTER_ADDRESS, LiquidityAdapterABI, signer);
    }
    return liquidityAdapter;
};

const getFinancingManager = () => {
    if (!financingManager) {
        if (!FINANCING_MANAGER_ADDRESS) throw new BridgeServiceError('FINANCING_MANAGER_ADDRESS not set');
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
        const fractionTokenAddress = process.env.FRACTION_TOKEN_ADDRESS;
        
        if (!fractionTokenAddress) {
            throw new BridgeServiceError(
                'FractionToken address not configured',
                'CONFIG_ERROR'
            );
        }
        
        const katanaChain = ethers.keccak256(ethers.toUtf8Bytes("katana"));
        
        console.log(`[BridgeService] Locking ERC1155 for bridge: tokenId=${collateralTokenId}, amount=${amount}`);
        
        const lockTx = await getBridgeAdapter().lockERC1155ForBridge(
            fractionTokenAddress, 
            collateralTokenId, 
            amount, 
            katanaChain
        );
        
        console.log(`[BridgeService] Lock transaction sent: ${lockTx.hash}`);
        const lockReceipt = await lockTx.wait();
        
        console.log(`[BridgeService] Lock confirmed, bridging asset...`);
        
        const bridgeTx = await getBridgeAdapter().bridgeERC1155Asset(
            lockTx.hash, 
            LIQUIDITY_ADAPTER_ADDRESS
        );
        
        console.log(`[BridgeService] Bridge transaction sent: ${bridgeTx.hash}`);
        const bridgeReceipt = await bridgeTx.wait();
        
        console.log(`[BridgeService] Bridge completed successfully`);
        
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
        
        console.log(`[BridgeService] Borrowing from Katana: asset=${asset}, amount=${amount}, collateral=${collateralTokenId}`);
        
        // First, bridge collateral if not already done
        const bridgeResult = await bridgeToKatana(collateralTokenId, amount, 'user');
        
        console.log(`[BridgeService] Borrowing from pool: assetAddress=${assetAddress}, amount=${amount}`);
        
        // Borrow from pool
        const borrowTx = await getLiquidityAdapter().borrowFromPool(
            assetAddress, 
            amount, 
            signer.address
        );
        
        console.log(`[BridgeService] Borrow transaction sent: ${borrowTx.hash}`);
        const receipt = await borrowTx.wait();
        
        console.log(`[BridgeService] Borrow completed successfully`);
        
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
        console.error('[BridgeService] Error borrowing from Katana:', error);
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
        
        console.log(`[BridgeService] Getting liquidity rates for: ${asset}`);
        
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
        console.error('[BridgeService] Error getting liquidity rates:', error);
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
        
        console.log(`[BridgeService] Repaying to Katana: asset=${asset}, amount=${amount}, loanId=${loanId}`);
        
        // Repay the loan
        const repayTx = await getLiquidityAdapter().repayToPool(loanId);
        
        console.log(`[BridgeService] Repay transaction sent: ${repayTx.hash}`);
        const receipt = await repayTx.wait();
        
        console.log(`[BridgeService] Repay completed successfully`);
        
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
        console.error('[BridgeService] Error repaying to Katana:', error);
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
