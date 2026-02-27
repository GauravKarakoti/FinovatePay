const { ethers } = require('ethers');
const path = require('path');
const { pool } = require('../config/database');
const errorResponse = require('../utils/errorResponse');

// Load artifact
// Try to load from artifacts (dev) first, then deployed (prod)
let EscrowContractArtifact;
try {
    EscrowContractArtifact = require('../../artifacts/contracts/EscrowContract.sol/EscrowContract.json');
} catch (e) {
    try {
        EscrowContractArtifact = require('../../deployed/EscrowContract.json');
    } catch (e2) {
        console.error("Could not load EscrowContract artifact");
    }
}

/**
 * Verify EIP-712 signature for meta-transaction
 * @param {string} user - User address
 * @param {string} functionData - Encoded function call data
 * @param {string} signature - EIP-712 signature
 * @param {number} nonce - Transaction nonce
 * @returns {boolean} - True if signature is valid
 */
const verifySignature = async (user, functionData, signature, nonce) => {
    try {
        // Reconstruct the message hash that was signed
        const messageHash = ethers.solidityPackedKeccak256(
            ['address', 'bytes', 'uint256'],
            [user, functionData, nonce]
        );

        // Recover the signer from the signature
        const recoveredAddress = ethers.verifyMessage(
            ethers.getBytes(messageHash),
            signature
        );

        // Verify the signer matches the user
        return recoveredAddress.toLowerCase() === user.toLowerCase();
    } catch (error) {
        console.error('Signature verification failed:', error);
        return false;
    }
};

/**
 * Get the current nonce for a user from database
 * @param {string} userAddress - User's Ethereum address
 * @returns {number} - Current nonce
 */
const getUserNonce = async (userAddress) => {
    try {
        const result = await pool.query(
            'SELECT nonce FROM meta_transaction_nonces WHERE user_address = $1',
            [userAddress.toLowerCase()]
        );

        if (result.rows.length === 0) {
            // Initialize nonce for new user
            await pool.query(
                'INSERT INTO meta_transaction_nonces (user_address, nonce) VALUES ($1, 0)',
                [userAddress.toLowerCase()]
            );
            return 0;
        }

        return parseInt(result.rows[0].nonce);
    } catch (error) {
        console.error('Error fetching nonce:', error);
        throw new Error('Failed to fetch user nonce');
    }
};

/**
 * Increment the nonce for a user
 * @param {string} userAddress - User's Ethereum address
 */
const incrementNonce = async (userAddress) => {
    try {
        await pool.query(
            'UPDATE meta_transaction_nonces SET nonce = nonce + 1 WHERE user_address = $1',
            [userAddress.toLowerCase()]
        );
    } catch (error) {
        console.error('Error incrementing nonce:', error);
        throw new Error('Failed to increment nonce');
    }
};

/**
 * Log relay transaction for audit trail
 * @param {object} data - Transaction data
 */
const logRelayTransaction = async (data) => {
    try {
        await pool.query(
            `INSERT INTO relay_transaction_logs 
             (user_address, function_data, tx_hash, status, relayer_address, gas_used, error_message, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [
                data.userAddress,
                data.functionData,
                data.txHash || null,
                data.status,
                data.relayerAddress,
                data.gasUsed || null,
                data.errorMessage || null
            ]
        );
    } catch (error) {
        console.error('Error logging relay transaction:', error);
        // Don't throw - logging failure shouldn't break the relay
    }
};

const relayTransaction = async (req, res) => {
    const startTime = Date.now();
    let txHash = null;
    let gasUsed = null;

    try {
        const { user, functionData, signature, nonce: providedNonce } = req.body;

        // Verify user is authenticated and matches the transaction user
        if (req.user.wallet_address.toLowerCase() !== user.toLowerCase()) {
            await logRelayTransaction({
                userAddress: user,
                functionData,
                status: 'REJECTED',
                relayerAddress: req.user.wallet_address,
                errorMessage: 'User mismatch: authenticated user does not match transaction user'
            });
            return errorResponse(res, "Forbidden: You can only relay transactions for your own address", 403);
        }

        if (!EscrowContractArtifact) {
            return errorResponse(res, "Contract artifact not found", 500);
        }

        // Initialize provider and signer (Relayer)
        const providerUrl = process.env.ALCHEMY_AMOY_URL;
        if (!providerUrl) {
            return errorResponse(res, "RPC URL not configured", 500);
        }

        const provider = new ethers.JsonRpcProvider(providerUrl);
        const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

        if (!privateKey) {
            return errorResponse(res, "Relayer wallet not configured", 500);
        }

        const wallet = new ethers.Wallet(privateKey, provider);

        // Get Contract Address
        let contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
        if (!contractAddress) {
            try {
                const addresses = require('../../deployed/contract-addresses.json');
                contractAddress = addresses.EscrowContract;
            } catch (e) {
                console.warn("Could not load contract-addresses.json");
            }
        }

        if (!contractAddress) {
            return errorResponse(res, "Contract address not configured", 500);
        }

        // Get and verify nonce
        const currentNonce = await getUserNonce(user);
        const nonceToUse = providedNonce !== undefined ? providedNonce : currentNonce;

        if (nonceToUse !== currentNonce) {
            await logRelayTransaction({
                userAddress: user,
                functionData,
                status: 'REJECTED',
                relayerAddress: wallet.address,
                errorMessage: `Invalid nonce: expected ${currentNonce}, got ${nonceToUse}`
            });
            return errorResponse(res, `Invalid nonce. Expected: ${currentNonce}, Provided: ${nonceToUse}`, 400);
        }

        // Verify signature
        const isValidSignature = await verifySignature(user, functionData, signature, nonceToUse);
        if (!isValidSignature) {
            await logRelayTransaction({
                userAddress: user,
                functionData,
                status: 'REJECTED',
                relayerAddress: wallet.address,
                errorMessage: 'Invalid signature'
            });
            return errorResponse(res, "Invalid signature", 401);
        }

        const contract = new ethers.Contract(contractAddress, EscrowContractArtifact.abi, wallet);

        console.log(`✅ Relaying transaction for user ${user} to contract ${contractAddress}`);
        console.log(`   Nonce: ${nonceToUse}, Relayer: ${wallet.address}`);

        // Call executeMetaTx
        const tx = await contract.executeMetaTx(user, functionData, signature);
        txHash = tx.hash;

        console.log(`📤 Transaction sent: ${txHash}`);

        // Wait for confirmation
        const receipt = await tx.wait();
        gasUsed = receipt.gasUsed.toString();

        console.log(`✅ Transaction confirmed: ${txHash}, Gas used: ${gasUsed}`);

        // Increment nonce after successful transaction
        await incrementNonce(user);

        // Log successful transaction
        await logRelayTransaction({
            userAddress: user,
            functionData,
            txHash,
            status: 'SUCCESS',
            relayerAddress: wallet.address,
            gasUsed
        });

        // Return success response
        res.json({ 
            success: true, 
            txHash,
            gasUsed,
            newNonce: currentNonce + 1,
            executionTime: Date.now() - startTime
        });

    } catch (error) {
        console.error("❌ Relay error:", error);

        // Log failed transaction
        await logRelayTransaction({
            userAddress: req.body.user,
            functionData: req.body.functionData,
            txHash,
            status: 'FAILED',
            relayerAddress: req.user?.wallet_address,
            gasUsed,
            errorMessage: error.message || 'Unknown error'
        });

        // Return detailed error for debugging (only in development)
        // Note: errorResponse handles production masking, so we just pass the error
        return errorResponse(res, error, 500);
    }
};

module.exports = { relayTransaction };
