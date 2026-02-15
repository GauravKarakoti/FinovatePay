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
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Contract instances
const bridgeAdapter = new ethers.Contract(BRIDGE_ADAPTER_ADDRESS, BridgeAdapterABI, signer);
const liquidityAdapter = new ethers.Contract(LIQUIDITY_ADAPTER_ADDRESS, LiquidityAdapterABI, signer);
const financingManager = new ethers.Contract(FINANCING_MANAGER_ADDRESS, FinancingManagerABI, signer);

// Supported assets (stablecoins)
const ASSETS = {
    USDC: process.env.USDC_ADDRESS,
    EURC: process.env.EURC_ADDRESS,
    BRLC: process.env.BRLC_ADDRESS,
};

/**
 * Bridge collateral to Katana (if needed)
 */
async function bridgeToKatana(collateralTokenId, amount, userId) {
    // Assuming collateral is FractionToken
    const fractionTokenAddress = process.env.FRACTION_TOKEN_ADDRESS;
    const katanaChain = ethers.keccak256(ethers.toUtf8Bytes("katana"));
    const lockId = await bridgeAdapter.lockERC1155ForBridge(fractionTokenAddress, collateralTokenId, amount, katanaChain);
    await bridgeAdapter.bridgeERC1155Asset(lockId, LIQUIDITY_ADAPTER_ADDRESS);
    return { lockId };
}

/**
 * Borrow from Katana liquidity pool
 */
async function borrowFromKatana(asset, amount, collateralTokenId) {
    const assetAddress = ASSETS[asset];
    if (!assetAddress) throw new Error('Unsupported asset');

    // First, bridge collateral if not already done
    await bridgeToKatana(collateralTokenId, amount, 'user'); // amount might need adjustment

    // Borrow from pool
    const loanId = await liquidityAdapter.borrowFromPool(assetAddress, amount, signer.address);
    return { loanId };
}

/**
 * Get liquidity rates for an asset
 */
async function getLiquidityRates(asset) {
    const assetAddress = ASSETS[asset];
    if (!assetAddress) throw new Error('Unsupported asset');

    const borrowRate = await liquidityAdapter.getBorrowRate(assetAddress);
    const availableLiquidity = await liquidityAdapter.getAvailableLiquidity(assetAddress);

    return {
        borrowRate: borrowRate.toString(),
        availableLiquidity: availableLiquidity.toString(),
    };
}

/**
 * Repay to Katana liquidity pool
 */
async function repayToKatana(asset, amount, loanId) {
    const assetAddress = ASSETS[asset];
    if (!assetAddress) throw new Error('Unsupported asset');

    // Repay the loan
    await liquidityAdapter.repayToPool(loanId);
    return { success: true };
}

module.exports = {
    bridgeToKatana,
    borrowFromKatana,
    getLiquidityRates,
    repayToKatana,
};
