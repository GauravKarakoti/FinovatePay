const { pool } = require('../config/database');
const RevolvingCreditLine = require('../models/RevolvingCreditLine');
const creditScoreService = require('./creditScoreService');
const { ethers } = require('ethers');

/**
 * Credit Line Service
 * 
 * Manages on-chain revolving credit lines with the following features:
 * - Credit limit based on credit score
 * - Collateralized with ERC1155 FractionTokens
 * - Drawdown and repayment functionality
 * - Interest calculation and accrual
 */

let revolvingCreditLineContract = null;

/**
 * Initialize the Revolving Credit Line contract
 */
const initializeContract = async () => {
    if (revolvingCreditLineContract) return revolvingCreditLineContract;
    
    const { getContract } = require('../config/blockchain');
    const contract = await getContract('RevolvingCreditLine');
    revolvingCreditLineContract = contract;
    return contract;
};

/**
 * Get the maximum credit limit based on credit score
 */
const getMaxCreditLimit = async (userId) => {
    try {
        const creditScore = await creditScoreService.getScoreByUserId(userId);
        
        if (!creditScore || creditScore.score < 60) {
            return { qualified: false, creditLimit: 0, creditScore: creditScore?.score || 0 };
        }

        // Calculate credit limit: score * 100 (configurable)
        const minScore = await RevolvingCreditLine.getConfig('min_credit_score');
        const multiplier = await RevolvingCreditLine.getConfig('credit_score_multiplier');
        
        const minScoreValue = parseInt(minScore) || 60;
        const multiplierValue = ethers.parseEther((parseInt(multiplier) || 100).toString());
        
        if (creditScore.score < minScoreValue) {
            return { qualified: false, creditLimit: 0, creditScore: creditScore.score };
        }

        const creditLimit = BigInt(creditScore.score) * multiplierValue;
        
        return {
            qualified: true,
            creditLimit: creditLimit.toString(),
            creditScore: creditScore.score,
            grade: creditScoreService.getScoreGrade(creditScore.score)
        };
    } catch (error) {
        console.error('[CreditLineService] Error getting max credit limit:', error);
        throw error;
    }
};

/**
 * Create a new credit line
 */
const createCreditLine = async (userId, walletAddress, data) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Get user's credit score
        const creditScore = await creditScoreService.getScoreByUserId(userId);
        
        if (!creditScore || creditScore.score < 60) {
            throw new Error('Credit score too low to qualify for credit line');
        }

        // 2. Get configuration
        const minScore = await RevolvingCreditLine.getConfig('min_credit_score', userId);
        const collateralRatio = await RevolvingCreditLine.getConfig('collateralization_ratio', userId);
        
        // 3. Validate credit limit
        const requestedLimit = BigInt(data.creditLimit);
        const maxLimit = BigInt(creditScore.score) * BigInt(ethers.parseEther('100').toString());
        
        if (requestedLimit > maxLimit) {
            throw new Error('Requested credit limit exceeds maximum allowed');
        }

        // 4. Calculate minimum collateral required
        const minCollateral = (requestedLimit * BigInt(collateralRatio || 150)) / BigInt(100);
        
        if (BigInt(data.collateralAmount) < minCollateral) {
            throw new Error(`Insufficient collateral. Minimum required: ${minCollateral.toString()}`);
        }

        // 5. Interact with smart contract
        const contract = await initializeContract();
        
        const tx = await contract.createCreditLine(
            data.creditLimit,
            data.interestRate || 500, // Default 5%
            data.collateralTokenId,
            data.collateralAmount,
            { from: walletAddress }
        );
        
        const receipt = await tx.wait();
        
        // Extract credit line ID from event
        const event = receipt.logs?.find(
            e => e.fragment?.name === 'CreditLineCreated'
        ) || receipt.events?.find(e => e.event === 'CreditLineCreated');
        
        const creditLineId = event?.args?.creditLineId || event?.args?.[0];
        
        if (!creditLineId) {
            throw new Error('Failed to get credit line ID from transaction');
        }

        // 6. Store in database
        const creditLine = await RevolvingCreditLine.create({
            creditLineId: creditLineId.toString(),
            userId,
            walletAddress,
            creditLimit: data.creditLimit,
            interestRate: data.interestRate || 500,
            collateralTokenId: data.collateralTokenId,
            collateralAmount: data.collateralAmount,
            collateralValue: data.collateralAmount // Simplified - would need price oracle for actual value
        });

        // 7. Record transaction
        await RevolvingCreditLine.recordTransaction({
            creditLineId: creditLineId.toString(),
            transactionType: 'credit_line_created',
            amount: data.creditLimit,
            transactionHash: receipt.hash,
            fromAddress: walletAddress,
            toAddress: contract.address,
            status: 'confirmed',
            metadata: { interestRate: data.interestRate || 500 }
        });

        await client.query('COMMIT');

        return {
            success: true,
            creditLineId: creditLineId.toString(),
            creditLine,
            transactionHash: receipt.hash
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[CreditLineService] Error creating credit line:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Draw funds from credit line
 */
const drawdown = async (userId, walletAddress, creditLineId, amount) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Verify credit line exists and belongs to user
        const creditLine = await RevolvingCreditLine.findById(creditLineId);
        
        if (!creditLine) {
            throw new Error('Credit line not found');
        }

        if (creditLine.user_id !== userId) {
            throw new Error('Unauthorized access to credit line');
        }

        if (!creditLine.is_active) {
            throw new Error('Credit line is not active');
        }

        // 2. Interact with smart contract
        const contract = await initializeContract();
        
        // Check available credit
        const availableCredit = await contract.getAvailableCredit(creditLineId);
        
        if (BigInt(amount) > availableCredit) {
            throw new Error('Insufficient available credit');
        }

        const tx = await contract.drawdown(creditLineId, amount, { from: walletAddress });
        const receipt = await tx.wait();

        // 3. Update database
        const newDrawnAmount = BigInt(creditLine.drawn_amount) + BigInt(amount);
        await RevolvingCreditLine.updateDrawnAmount(creditLineId, newDrawnAmount.toString());

        // 4. Record transaction
        await RevolvingCreditLine.recordTransaction({
            creditLineId,
            transactionType: 'drawdown',
            amount,
            transactionHash: receipt.hash,
            fromAddress: contract.address,
            toAddress: walletAddress,
            status: 'confirmed',
            metadata: { newDrawnAmount: newDrawnAmount.toString() }
        });

        await client.query('COMMIT');

        return {
            success: true,
            creditLineId,
            amount,
            newDrawnAmount: newDrawnAmount.toString(),
            transactionHash: receipt.hash
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[CreditLineService] Error during drawdown:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Repay credit line
 */
const repay = async (userId, walletAddress, creditLineId, amount) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Verify credit line
        const creditLine = await RevolvingCreditLine.findById(creditLineId);
        
        if (!creditLine) {
            throw new Error('Credit line not found');
        }

        if (creditLine.user_id !== userId) {
            throw new Error('Unauthorized access to credit line');
        }

        // 2. Get current debt from contract
        const contract = await initializeContract();
        const totalDebt = await contract.getTotalDebt(creditLineId);
        
        // 3. Interact with smart contract
        const tx = await contract.repay(creditLineId, amount, { from: walletAddress });
        const receipt = await tx.wait();

        // 4. Extract repayment details from event
        const event = receipt.logs?.find(
            e => e.fragment?.name === 'Repayment'
        ) || receipt.events?.find(e => e.event === 'Repayment');
        
        const interestPaid = event?.args?.interestPaid || '0';
        const newDrawnAmount = event?.args?.newDrawnAmount || '0';

        // 5. Update database
        await RevolvingCreditLine.updateDrawnAmount(creditLineId, newDrawnAmount.toString());

        // 6. Record transaction
        await RevolvingCreditLine.recordTransaction({
            creditLineId,
            transactionType: 'repayment',
            amount,
            interestPaid: interestPaid.toString(),
            transactionHash: receipt.hash,
            fromAddress: walletAddress,
            toAddress: contract.address,
            status: 'confirmed',
            metadata: { newDrawnAmount: newDrawnAmount.toString() }
        });

        await client.query('COMMIT');

        return {
            success: true,
            creditLineId,
            amount,
            interestPaid: interestPaid.toString(),
            newDrawnAmount: newDrawnAmount.toString(),
            transactionHash: receipt.hash
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[CreditLineService] Error during repayment:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Deposit additional collateral
 */
const depositCollateral = async (userId, walletAddress, creditLineId, tokenId, amount) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Verify credit line
        const creditLine = await RevolvingCreditLine.findById(creditLineId);
        
        if (!creditLine) {
            throw new Error('Credit line not found');
        }

        if (creditLine.user_id !== userId) {
            throw new Error('Unauthorized access to credit line');
        }

        // 2. Get contract
        const contract = await initializeContract();
        
        // 3. Interact with smart contract
        const tx = await contract.depositCollateral(creditLineId, tokenId, amount, { from: walletAddress });
        const receipt = await tx.wait();

        // 4. Update database
        const newCollateralAmount = BigInt(creditLine.collateral_amount) + BigInt(amount);
        await RevolvingCreditLine.updateCollateral(
            creditLineId,
            newCollateralAmount.toString(),
            newCollateralAmount.toString() // Simplified
        );

        // 5. Record transaction and history
        await RevolvingCreditLine.recordTransaction({
            creditLineId,
            transactionType: 'collateral_deposit',
            amount,
            transactionHash: receipt.hash,
            fromAddress: walletAddress,
            toAddress: contract.address,
            status: 'confirmed',
            metadata: { tokenId: tokenId.toString() }
        });

        await RevolvingCreditLine.recordCollateralHistory({
            creditLineId,
            tokenId,
            amountBefore: creditLine.collateral_amount,
            amountAfter: newCollateralAmount.toString(),
            action: 'deposit',
            transactionHash: receipt.hash
        });

        await client.query('COMMIT');

        return {
            success: true,
            creditLineId,
            tokenId,
            amount,
            newCollateralAmount: newCollateralAmount.toString(),
            transactionHash: receipt.hash
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[CreditLineService] Error depositing collateral:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Withdraw excess collateral
 */
const withdrawCollateral = async (userId, walletAddress, creditLineId, amount) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Verify credit line
        const creditLine = await RevolvingCreditLine.findById(creditLineId);
        
        if (!creditLine) {
            throw new Error('Credit line not found');
        }

        if (creditLine.user_id !== userId) {
            throw new Error('Unauthorized access to credit line');
        }

        // 2. Get contract
        const contract = await initializeContract();
        
        // 3. Interact with smart contract
        const tx = await contract.withdrawCollateral(creditLineId, amount, { from: walletAddress });
        const receipt = await tx.wait();

        // 4. Update database
        const newCollateralAmount = BigInt(creditLine.collateral_amount) - BigInt(amount);
        await RevolvingCreditLine.updateCollateral(
            creditLineId,
            newCollateralAmount.toString(),
            newCollateralAmount.toString()
        );

        // 5. Record transaction and history
        await RevolvingCreditLine.recordTransaction({
            creditLineId,
            transactionType: 'collateral_withdrawal',
            amount,
            transactionHash: receipt.hash,
            fromAddress: contract.address,
            toAddress: walletAddress,
            status: 'confirmed'
        });

        await RevolvingCreditLine.recordCollateralHistory({
            creditLineId,
            tokenId: creditLine.collateral_token_id,
            amountBefore: creditLine.collateral_amount,
            amountAfter: newCollateralAmount.toString(),
            action: 'withdrawal',
            transactionHash: receipt.hash
        });

        await client.query('COMMIT');

        return {
            success: true,
            creditLineId,
            amount,
            newCollateralAmount: newCollateralAmount.toString(),
            transactionHash: receipt.hash
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[CreditLineService] Error withdrawing collateral:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Close credit line
 */
const closeCreditLine = async (userId, walletAddress, creditLineId) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Verify credit line
        const creditLine = await RevolvingCreditLine.findById(creditLineId);
        
        if (!creditLine) {
            throw new Error('Credit line not found');
        }

        if (creditLine.user_id !== userId) {
            throw new Error('Unauthorized access to credit line');
        }

        // 2. Get contract
        const contract = await initializeContract();
        
        // Check if fully repaid
        const totalDebt = await contract.getTotalDebt(creditLineId);
        if (totalDebt > 0) {
            throw new Error('Cannot close credit line with outstanding debt');
        }

        // 3. Interact with smart contract
        const tx = await contract.closeCreditLine(creditLineId, { from: walletAddress });
        const receipt = await tx.wait();

        // 4. Update database
        await RevolvingCreditLine.updateStatus(creditLineId, 'closed');

        // 5. Record transaction
        await RevolvingCreditLine.recordTransaction({
            creditLineId,
            transactionType: 'credit_line_closed',
            amount: '0',
            transactionHash: receipt.hash,
            fromAddress: walletAddress,
            toAddress: contract.address,
            status: 'confirmed'
        });

        await client.query('COMMIT');

        return {
            success: true,
            creditLineId,
            transactionHash: receipt.hash
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[CreditLineService] Error closing credit line:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Get credit line details
 */
const getCreditLineDetails = async (creditLineId) => {
    try {
        // Get from database
        const creditLine = await RevolvingCreditLine.findById(creditLineId);
        
        if (!creditLine) {
            return null;
        }

        // Get from smart contract for real-time data
        const contract = await initializeContract();
        const onChainData = await contract.getCreditLine(creditLineId);
        
        // Calculate available credit
        const availableCredit = await contract.getAvailableCredit(creditLineId);
        const totalDebt = await contract.getTotalDebt(creditLineId);

        return {
            ...creditLine,
            onChainData: {
                creditLimit: onChainData.creditLimit.toString(),
                drawnAmount: onChainData.drawnAmount.toString(),
                interestRate: onChainData.interestRate.toString(),
                isActive: onChainData.isActive,
                collateralAmount: onChainData.collateralAmount.toString()
            },
            availableCredit: availableCredit.toString(),
            totalDebt: totalDebt.toString(),
            utilizationRatio: onChainData.creditLimit > 0 
                ? (BigInt(totalDebt.toString()) * BigInt(10000) / BigInt(onChainData.creditLimit.toString()) / 100).toString()
                : '0'
        };
    } catch (error) {
        console.error('[CreditLineService] Error getting credit line details:', error);
        throw error;
    }
};

/**
 * Get user's credit line
 */
const getUserCreditLine = async (userId) => {
    try {
        const creditLine = await RevolvingCreditLine.findByUserId(userId);
        
        if (!creditLine) {
            return null;
        }

        return await getCreditLineDetails(creditLine.credit_line_id);
    } catch (error) {
        console.error('[CreditLineService] Error getting user credit line:', error);
        throw error;
    }
};

/**
 * Get credit line transaction history
 */
const getTransactionHistory = async (creditLineId, limit = 50) => {
    try {
        return await RevolvingCreditLine.getTransactionHistory(creditLineId, limit);
    } catch (error) {
        console.error('[CreditLineService] Error getting transaction history:', error);
        throw error;
    }
};

/**
 * Get credit line configuration
 */
const getCreditLineConfig = async (userId = null) => {
    try {
        const configs = await pool.query(
            'SELECT * FROM credit_line_config WHERE is_global = true OR user_id = $1',
            [userId]
        );
        
        const config = {};
        configs.rows.forEach(row => {
            config[row.parameter_key] = row.parameter_value;
        });
        
        return config;
    } catch (error) {
        console.error('[CreditLineService] Error getting config:', error);
        throw error;
    }
};

module.exports = {
    initializeContract,
    getMaxCreditLimit,
    createCreditLine,
    drawdown,
    repay,
    depositCollateral,
    withdrawCollateral,
    closeCreditLine,
    getCreditLineDetails,
    getUserCreditLine,
    getTransactionHistory,
    getCreditLineConfig
};
