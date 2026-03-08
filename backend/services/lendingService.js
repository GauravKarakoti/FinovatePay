const { pool } = require('../config/database');
const creditScoreService = require('./creditScoreService');
const creditRiskService = require('./creditRiskService');
const { ethers } = require('ethers');
const crypto = require('crypto');

/**
 * Lending Service
 * 
 * Manages the Dynamic Collateralized Lending Protocol with:
 * - Dynamic LTV based on credit risk
 * - Invoice fraction (ERC1155) collateral
 * - Escrow deposit collateral
 * - Automated liquidation
 */

let lendingPoolContract = null;

/**
 * Initialize the Lending Pool contract
 */
const initializeContract = async () => {
    if (lendingPoolContract) return lendingPoolContract;
    
    const { getContract } = require('../config/blockchain');
    const contract = await getContract('LendingPool');
    lendingPoolContract = contract;
    return contract;
};

/**
 * Get pool configuration from database
 */
const getPoolConfig = async () => {
    try {
        const result = await pool.query(
            'SELECT parameter_key, parameter_value FROM lending_pool_config WHERE is_global = true'
        );
        
        const config = {};
        result.rows.forEach(row => {
            config[row.parameter_key] = row.parameter_value;
        });
        
        return config;
    } catch (error) {
        console.error('[LendingService] Error getting pool config:', error);
        throw error;
    }
};

/**
 * Calculate dynamic LTV for a borrower
 */
const calculateDynamicLTV = async (userId, walletAddress, collateralValue, requestedAmount) => {
    try {
        // Get credit score
        const creditScore = await creditScoreService.getScoreByUserId(userId);
        const score = creditScore?.score || 50;
        
        // Get credit risk profile for more accurate LTV
        let riskAdjustment = 0;
        try {
            const riskProfile = await creditRiskService.getRiskProfileByUserId(userId);
            if (riskProfile) {
                // Adjust based on risk profile
                if (riskProfile.riskScore <= 20) {
                    riskAdjustment = 1000; // +10% for excellent risk
                } else if (riskProfile.riskScore <= 35) {
                    riskAdjustment = 500; // +5% for good risk
                } else if (riskProfile.riskScore > 70) {
                    riskAdjustment = -1000; // -10% for high risk
                }
            }
        } catch (error) {
            console.warn('[LendingService] Could not get risk profile:', error.message);
        }
        
        // Get pool config
        const config = await getPoolConfig();
        const minCollateralRatio = parseInt(config.min_collateral_ratio) || 12000;
        const riskScoreWeight = parseInt(config.risk_score_weight) || 30;
        
        // Calculate base LTV from collateral
        let baseLTV = 0;
        if (requestedAmount > 0 && collateralValue > 0) {
            baseLTV = (collateralValue * 10000) / requestedAmount;
        }
        
        // Cap at max
        if (baseLTV > 10000) baseLTV = 10000;
        
        // Adjust for credit score
        let creditScoreAdjustment = 0;
        if (score >= 80) {
            creditScoreAdjustment = 1000;
        } else if (score >= 70) {
            creditScoreAdjustment = 500;
        } else if (score < 60) {
            creditScoreAdjustment = -1000;
        }
        
        // Combine adjustments
        const totalAdjustment = (creditScoreAdjustment * riskScoreWeight / 100) + (riskAdjustment * (100 - riskScoreWeight) / 100 / 10);
        
        const finalLTV = Math.max(0, Math.min(10000, baseLTV + totalAdjustment));
        
        return {
            ltv: finalLTV,
            baseLTV,
            creditScore: score,
            creditScoreAdjustment,
            riskAdjustment,
            minCollateralRatio
        };
    } catch (error) {
        console.error('[LendingService] Error calculating LTV:', error);
        throw error;
    }
};

/**
 * Create a new loan with collateral
 */
const createLoan = async (userId, walletAddress, data) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Get user's credit score
        const creditScore = await creditScoreService.getScoreByUserId(userId);
        const config = await getPoolConfig();
        
        const minScore = parseInt(config.min_credit_score) || 60;
        
        if (!creditScore || creditScore.score < minScore) {
            throw new Error(`Credit score too low. Minimum required: ${minScore}`);
        }

        // 2. Validate loan parameters
        const minLoanSize = BigInt(config.min_loan_size);
        const maxLoanSize = BigInt(config.max_loan_size);
        const principal = BigInt(data.principal);
        
        if (principal < minLoanSize) {
            throw new Error(`Principal below minimum: ${minLoanSize}`);
        }
        if (principal > maxLoanSize) {
            throw new Error(`Principal exceeds maximum: ${maxLoanSize}`);
        }

        // 3. Get collateral value (from fraction tokens or escrow)
        const collateralValue = BigInt(data.collateralValue || 0);
        const minCollateralRatio = BigInt(config.min_collateral_ratio);
        
        // Calculate required collateral
        const requiredCollateral = (principal * minCollateralRatio) / BigInt(10000);
        
        if (collateralValue < requiredCollateral) {
            throw new Error(`Insufficient collateral. Required: ${requiredCollateral}, Provided: ${collateralValue}`);
        }

        // 4. Calculate dynamic interest rate based on risk
        let interestRate = parseInt(data.interestRate) || parseInt(config.base_interest_rate);
        
        try {
            const riskProfile = await creditRiskService.getRiskProfileByUserId(userId);
            if (riskProfile && riskProfile.dynamicRate) {
                // Use dynamic rate from risk profile (convert percentage to bps)
                interestRate = Math.round(riskProfile.dynamicRate.rate * 100);
            }
        } catch (error) {
            console.warn('[LendingService] Could not get dynamic rate:', error.message);
        }

        // 5. Interact with smart contract
        const contract = await initializeContract();
        
        const loanDuration = data.loanDuration || 180 * 24 * 60 * 60; // 180 days default
        
        const tx = await contract.createLoan(
            data.principal,
            interestRate,
            data.collateralTokenId || 0,
            data.collateralAmount || 0,
            data.collateralValue,
            loanDuration,
            { from: walletAddress }
        );
        
        const receipt = await tx.wait();
        
        // Extract loan ID from event
        const event = receipt.logs?.find(
            e => e.fragment?.name === 'LoanCreated'
        ) || receipt.events?.find(e => e.event === 'LoanCreated');
        
        const loanId = event?.args?.loanId || event?.args?.[0];
        
        if (!loanId) {
            throw new Error('Failed to get loan ID from transaction');
        }

        // 6. Store in database
        const loanIdStr = loanId.toString();
        
        // Calculate LTV
        const ltvResult = await calculateDynamicLTV(userId, walletAddress, collateralValue, principal);
        
        await client.query(
            `INSERT INTO loans (
                loan_id, user_id, wallet_address, principal, interest_rate,
                total_debt, collateral_value, ltv, loan_duration,
                maturity_date, status, transaction_hash, block_number
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() + ($9 * INTERVAL '1 day'), $10, $11, $12)`,
            [
                loanIdStr, userId, walletAddress, data.principal.toString(),
                interestRate, data.principal.toString(), data.collateralValue.toString(),
                ltvResult.ltv, loanDuration, 'active', receipt.hash, receipt.blockNumber
            ]
        );

        // 7. Create collateral position
        if (data.collateralTokenId && data.collateralAmount) {
            const positionId = crypto.randomUUID();
            await client.query(
                `INSERT INTO collateral_positions (
                    position_id, loan_id, user_id, wallet_address,
                    collateral_type, token_contract, token_id, amount, value, is_locked
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    positionId, loanIdStr, userId, walletAddress,
                    'fraction_token', data.collateralContract || (await contract.fractionToken()), 
                    data.collateralTokenId.toString(), data.collateralAmount.toString(),
                    data.collateralValue.toString(), true
                ]
            );
        }

        // 8. Record collateral history
        await client.query(
            `INSERT INTO loan_collateral_history (
                history_id, loan_id, user_id, action, collateral_type,
                token_contract, token_id, amount, value,
                collateral_value_before, collateral_value_after, transaction_hash
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
                crypto.randomUUID(), loanIdStr, userId, 'deposit',
                'fraction_token', data.collateralContract || '0x0',
                data.collateralTokenId?.toString() || '0', data.collateralAmount?.toString() || '0',
                data.collateralValue.toString(), '0', data.collateralValue.toString(), receipt.hash
            ]
        );

        await client.query('COMMIT');

        return {
            success: true,
            loanId: loanIdStr,
            principal: data.principal,
            interestRate,
            ltv: ltvResult.ltv,
            collateralValue: data.collateralValue,
            transactionHash: receipt.hash
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[LendingService] Error creating loan:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Deposit additional collateral
 */
const depositCollateral = async (userId, walletAddress, loanId, data) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Verify loan exists and belongs to user
        const loanResult = await client.query(
            'SELECT * FROM loans WHERE loan_id = $1 AND user_id = $2',
            [loanId, userId]
        );
        
        if (loanResult.rows.length === 0) {
            throw new Error('Loan not found');
        }
        
        const loan = loanResult.rows[0];
        
        if (loan.status !== 'active') {
            throw new Error('Loan is not active');
        }

        // 2. Interact with smart contract
        const contract = await initializeContract();
        
        const tx = await contract.depositCollateral(
            loanId,
            data.collateralType === 'escrow_deposit' ? 1 : 0,
            data.tokenContract,
            data.tokenId,
            data.amount,
            data.value,
            { from: walletAddress }
        );
        
        const receipt = await tx.wait();

        // 3. Update database
        const newCollateralValue = BigInt(loan.collateral_value) + BigInt(data.value);
        
        await client.query(
            'UPDATE loans SET collateral_value = $1, updated_at = NOW() WHERE loan_id = $2',
            [newCollateralValue.toString(), loanId]
        );

        // 4. Create collateral position
        const positionId = crypto.randomUUID();
        await client.query(
            `INSERT INTO collateral_positions (
                position_id, loan_id, user_id, wallet_address,
                collateral_type, token_contract, token_id, amount, value, is_locked
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                positionId, loanId, userId, walletAddress,
                data.collateralType, data.tokenContract,
                data.tokenId.toString(), data.amount.toString(),
                data.value.toString(), true
            ]
        );

        // 5. Record history
        await client.query(
            `INSERT INTO loan_collateral_history (
                history_id, loan_id, user_id, action, collateral_type,
                token_contract, token_id, amount, value,
                collateral_value_before, collateral_value_after, transaction_hash
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
                crypto.randomUUID(), loanId, userId, 'deposit',
                data.collateralType, data.tokenContract,
                data.tokenId.toString(), data.amount.toString(),
                data.value.toString(), loan.collateral_value,
                newCollateralValue.toString(), receipt.hash
            ]
        );

        await client.query('COMMIT');

        return {
            success: true,
            loanId,
            positionId,
            amount: data.amount,
            value: data.value,
            newCollateralValue: newCollateralValue.toString(),
            transactionHash: receipt.hash
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[LendingService] Error depositing collateral:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Withdraw collateral
 */
const withdrawCollateral = async (userId, walletAddress, loanId, amount, value) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Verify loan
        const loanResult = await client.query(
            'SELECT * FROM loans WHERE loan_id = $1 AND user_id = $2',
            [loanId, userId]
        );
        
        if (loanResult.rows.length === 0) {
            throw new Error('Loan not found');
        }
        
        const loan = loanResult.rows[0];
        
        if (loan.status !== 'active') {
            throw new Error('Loan is not active');
        }

        // 2. Check collateral availability
        const collateralResult = await client.query(
            `SELECT SUM(amount) as total_amount, SUM(value) as total_value 
             FROM collateral_positions 
             WHERE loan_id = $1 AND user_id = $2 AND is_locked = false`,
            [loanId, userId]
        );
        
        const availableCollateral = BigInt(collateralResult.rows[0]?.total_value || 0);
        
        if (availableCollateral < BigInt(value)) {
            throw new Error('Insufficient unlocked collateral');
        }

        // 3. Check minimum collateral ratio after withdrawal
        const config = await getPoolConfig();
        const minCollateralRatio = BigInt(config.min_collateral_ratio);
        const remainingValue = BigInt(loan.collateral_value) - BigInt(value);
        const requiredValue = (BigInt(loan.total_debt) * minCollateralRatio) / BigInt(10000);
        
        if (remainingValue < requiredValue) {
            throw new Error('Withdrawal would violate minimum collateral ratio');
        }

        // 4. Interact with smart contract
        const contract = await initializeContract();
        
        const tx = await contract.withdrawCollateral(loanId, amount, value, { from: walletAddress });
        const receipt = await tx.wait();

        // 5. Update database
        await client.query(
            'UPDATE loans SET collateral_value = $1, updated_at = NOW() WHERE loan_id = $2',
            [remainingValue.toString(), loanId]
        );

        // 6. Update or remove collateral position
        await client.query(
            `UPDATE collateral_positions 
             SET amount = amount - $1, value = value - $2, updated_at = NOW()
             WHERE loan_id = $3 AND user_id = $4 AND is_locked = false
             RETURNING position_id`,
            [amount.toString(), value.toString(), loanId, userId]
        );

        // 7. Record history
        await client.query(
            `INSERT INTO loan_collateral_history (
                history_id, loan_id, user_id, action, collateral_type,
                amount, value, collateral_value_before, collateral_value_after, transaction_hash
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                crypto.randomUUID(), loanId, userId, 'withdraw',
                'fraction_token', amount.toString(), value.toString(),
                loan.collateral_value, remainingValue.toString(), receipt.hash
            ]
        );

        await client.query('COMMIT');

        return {
            success: true,
            loanId,
            amount,
            value,
            remainingCollateralValue: remainingValue.toString(),
            transactionHash: receipt.hash
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[LendingService] Error withdrawing collateral:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Borrow additional funds
 */
const borrow = async (userId, walletAddress, loanId, amount) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Verify loan
        const loanResult = await client.query(
            'SELECT * FROM loans WHERE loan_id = $1 AND user_id = $2',
            [loanId, userId]
        );
        
        if (loanResult.rows.length === 0) {
            throw new Error('Loan not found');
        }
        
        const loan = loanResult.rows[0];
        
        if (loan.status !== 'active') {
            throw new Error('Loan is not active');
        }

        // 2. Check max borrow amount
        const contract = await initializeContract();
        const maxBorrow = await contract.getMaxBorrowAmount(loanId);
        
        if (BigInt(amount) > maxBorrow) {
            throw new Error('Exceeds maximum borrow amount');
        }

        // 3. Interact with smart contract
        const tx = await contract.borrow(loanId, amount, { from: walletAddress });
        const receipt = await tx.wait();

        // 4. Update database
        const newTotalDebt = BigInt(loan.total_debt) + BigInt(amount);
        
        // Recalculate LTV
        const ltvResult = await calculateDynamicLTV(
            userId, 
            walletAddress, 
            BigInt(loan.collateral_value), 
            newTotalDebt
        );
        
        await client.query(
            `UPDATE loans SET 
                principal = principal + $1,
                total_debt = $2,
                ltv = $3,
                is_undercollateralized = $4,
                updated_at = NOW()
             WHERE loan_id = $5`,
            [amount.toString(), newTotalDebt.toString(), ltvResult.ltv, ltvResult.ltv > 8500, loanId]
        );

        await client.query('COMMIT');

        return {
            success: true,
            loanId,
            amount,
            newTotalDebt: newTotalDebt.toString(),
            newLTV: ltvResult.ltv,
            transactionHash: receipt.hash
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[LendingService] Error borrowing:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Repay a loan
 */
const repay = async (userId, walletAddress, loanId, amount) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Verify loan
        const loanResult = await client.query(
            'SELECT * FROM loans WHERE loan_id = $1 AND user_id = $2',
            [loanId, userId]
        );
        
        if (loanResult.rows.length === 0) {
            throw new Error('Loan not found');
        }
        
        const loan = loanResult.rows[0];
        
        if (loan.status !== 'active') {
            throw new Error('Loan is not active');
        }

        // 2. Interact with smart contract
        const contract = await initializeContract();
        
        const tx = await contract.repay(loanId, amount, { from: walletAddress });
        const receipt = await tx.wait();

        // Extract repayment details from event
        const event = receipt.logs?.find(
            e => e.fragment?.name === 'Repaid'
        ) || receipt.events?.find(e => e.event === 'Repaid');
        
        const interestPaid = event?.args?.interestPaid?.toString() || '0';
        const remainingDebt = event?.args?.remainingDebt?.toString() || '0';

        // 3. Update database
        const newStatus = remainingDebt === '0' ? 'repaid' : 'active';
        const newCollateralValue = newStatus === 'repaid' ? loan.collateral_value : loan.collateral_value;
        
        await client.query(
            `UPDATE loans SET 
                total_debt = $1,
                status = $2,
                is_undercollateralized = $3,
                updated_at = NOW()
             WHERE loan_id = $4`,
            [remainingDebt, newStatus, false, loanId]
        );

        // 4. Unlock collateral if fully repaid
        if (newStatus === 'repaid') {
            await client.query(
                'UPDATE collateral_positions SET is_locked = false WHERE loan_id = $1',
                [loanId]
            );
        }

        // 5. Record repayment
        await client.query(
            `INSERT INTO loan_repayments (
                repayment_id, loan_id, user_id, amount, interest_paid,
                principal_paid, remaining_debt, status, transaction_hash
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                crypto.randomUUID(), loanId, userId, amount,
                interestPaid, (BigInt(amount) - BigInt(interestPaid)).toString(),
                remainingDebt, 'completed', receipt.hash
            ]
        );

        await client.query('COMMIT');

        return {
            success: true,
            loanId,
            amount,
            interestPaid,
            remainingDebt,
            status: newStatus,
            transactionHash: receipt.hash
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[LendingService] Error repaying:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Liquidate an undercollateralized loan
 */
const liquidate = async (liquidatorId, liquidatorAddress, loanId) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Verify loan is liquidatable
        const loanResult = await client.query(
            'SELECT * FROM loans WHERE loan_id = $1 AND status = $2',
            [loanId, 'active']
        );
        
        if (loanResult.rows.length === 0) {
            throw new Error('Loan not found or not active');
        }
        
        const loan = loanResult.rows[0];

        // 2. Interact with smart contract
        const contract = await initializeContract();
        
        const tx = await contract.liquidate(loanId, { from: liquidatorAddress });
        const receipt = await tx.wait();

        // Extract liquidation details from event
        const event = receipt.logs?.find(
            e => e.fragment?.name === 'Liquidated'
        ) || receipt.events?.find(e => e.event === 'Liquidated');
        
        const collateralSeized = event?.args?.collateralSeized?.toString() || '0';
        const debtCovered = event?.args?.debtCovered?.toString() || '0';
        const bonus = event?.args?.bonus?.toString() || '0';

        // 3. Update database
        await client.query(
            `UPDATE loans SET 
                total_debt = 0,
                status = 'liquidated',
                is_undercollateralized = false,
                updated_at = NOW()
             WHERE loan_id = $1`,
            [loanId]
        );

        // 4. Record liquidation event
        await client.query(
            `INSERT INTO liquidation_events (
                liquidation_id, loan_id, liquidator_id, liquidator_address,
                collateral_seized_value, debt_covered, liquidation_bonus,
                status, transaction_hash, confirmed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [
                crypto.randomUUID(), loanId, liquidatorId, liquidatorAddress,
                collateralSeized, debtCovered, bonus,
                'completed', receipt.hash
            ]
        );

        // 5. Mark collateral as seized
        await client.query(
            `UPDATE collateral_positions 
             SET is_locked = true, amount = 0, value = 0 
             WHERE loan_id = $1`,
            [loanId]
        );

        // 6. Record collateral seizure in history
        await client.query(
            `INSERT INTO loan_collateral_history (
                history_id, loan_id, user_id, action, collateral_type,
                value, collateral_value_before, collateral_value_after, transaction_hash
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                crypto.randomUUID(), loanId, loan.user_id, 'seized',
                'fraction_token', collateralSeized, loan.collateral_value, '0', receipt.hash
            ]
        );

        await client.query('COMMIT');

        return {
            success: true,
            loanId,
            liquidator: liquidatorAddress,
            collateralSeized,
            debtCovered,
            bonus,
            transactionHash: receipt.hash
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[LendingService] Error liquidating:', error);
        throw error;
    } finally {
        client.release();
    }
};

/**
 * Get loan details
 */
const getLoanDetails = async (loanId) => {
    try {
        // Get from database
        const loanResult = await pool.query(
            'SELECT * FROM loans WHERE loan_id = $1',
            [loanId]
        );
        
        if (loanResult.rows.length === 0) {
            return null;
        }

        const loan = loanResult.rows[0];

        // Get collateral positions
        const collateralResult = await pool.query(
            'SELECT * FROM collateral_positions WHERE loan_id = $1',
            [loanId]
        );

        // Get on-chain data for real-time values
        let onChainData = {};
        try {
            const contract = await initializeContract();
            const onChainLoan = await contract.getLoan(loanId);
            
            onChainData = {
                principal: onChainLoan.principal.toString(),
                totalDebt: onChainLoan.totalDebt.toString(),
                interestRate: onChainLoan.interestRate.toString(),
                collateralValue: onChainLoan.collateralValue.toString(),
                ltv: onChainLoan.ltv.toString(),
                isUndercollateralized: onChainLoan.isUndercollateralized,
                status: onChainLoan.status
            };
        } catch (error) {
            console.warn('[LendingService] Could not get on-chain data:', error.message);
        }

        return {
            ...loan,
            onChainData,
            collateralPositions: collateralResult.rows
        };
    } catch (error) {
        console.error('[LendingService] Error getting loan details:', error);
        throw error;
    }
};

/**
 * Get user's loans
 */
const getUserLoans = async (userId) => {
    try {
        const result = await pool.query(
            'SELECT * FROM loans WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        
        return result.rows;
    } catch (error) {
        console.error('[LendingService] Error getting user loans:', error);
        throw error;
    }
};

/**
 * Get loan eligibility (calculate max borrow)
 */
const getLoanEligibility = async (userId) => {
    try {
        const config = await getPoolConfig();
        
        // Get credit score
        const creditScore = await creditScoreService.getScoreByUserId(userId);
        
        if (!creditScore || creditScore.score < 60) {
            return {
                eligible: false,
                reason: 'Credit score below minimum',
                creditScore: creditScore?.score || 0
            };
        }

        // Get risk profile
        let riskProfile = null;
        try {
            riskProfile = await creditRiskService.getRiskProfileByUserId(userId);
        } catch (error) {
            console.warn('[LendingService] Could not get risk profile:', error.message);
        }

        // Calculate max loan based on credit score
        const creditScoreMultiplier = 100; // $100 per credit point
        const maxLoanByScore = creditScore.score * creditScoreMultiplier * 1e6; // USDC decimals
        
        const maxLoanByConfig = BigInt(config.max_loan_size);
        const maxLoan = maxLoanByScore < Number(maxLoanByConfig) ? maxLoanByScore : Number(maxLoanByConfig);

        return {
            eligible: true,
            creditScore: creditScore.score,
            grade: creditScoreService.getScoreGrade(creditScore.score),
            maxLoanSize: maxLoan.toString(),
            interestRate: riskProfile?.dynamicRate?.rate || 5.0,
            minCollateralRatio: parseInt(config.min_collateral_ratio) / 100,
            config
        };
    } catch (error) {
        console.error('[LendingService] Error getting eligibility:', error);
        throw error;
    }
};

/**
 * Get liquidation candidates (undercollateralized loans)
 */
const getLiquidationCandidates = async (limit = 10) => {
    try {
        const result = await pool.query(
            `SELECT * FROM loans 
             WHERE status = 'active' AND is_undercollateralized = true 
             ORDER BY ltv DESC 
             LIMIT $1`,
            [limit]
        );
        
        return result.rows;
    } catch (error) {
        console.error('[LendingService] Error getting liquidation candidates:', error);
        throw error;
    }
};

/**
 * Get pool statistics
 */
const getPoolStats = async () => {
    try {
        // Get database stats
        const statsResult = await pool.query(
            `SELECT 
                COUNT(*) FILTER (WHERE status = 'active') as active_loans,
                COUNT(*) as total_loans,
                SUM(principal) FILTER (WHERE status = 'active') as total_borrowed,
                SUM(collateral_value) FILTER (WHERE status = 'active') as total_collateral,
                AVG(ltv) FILTER (WHERE status = 'active') as average_ltv
             FROM loans`
        );

        const stats = statsResult.rows[0];
        
        // Get config
        const config = await getPoolConfig();

        // Try to get on-chain stats
        let onChainStats = {};
        try {
            const contract = await initializeContract();
            onChainStats = {
                totalDeposits: (await contract.getTotalPoolValue()).toString(),
                totalBorrowed: (await contract.totalBorrowed()).toString(),
                utilization: (await contract.getPoolUtilization()).toString()
            };
        } catch (error) {
            console.warn('[LendingService] Could not get on-chain stats:', error.message);
        }

        return {
            activeLoans: parseInt(stats.active_loans) || 0,
            totalLoans: parseInt(stats.total_loans) || 0,
            totalBorrowed: stats.total_borrowed || '0',
            totalCollateral: stats.total_collateral || '0',
            averageLTV: Math.round(parseFloat(stats.average_ltv) || 0),
            config,
            onChainStats
        };
    } catch (error) {
        console.error('[LendingService] Error getting pool stats:', error);
        throw error;
    }
};

module.exports = {
    initializeContract,
    getPoolConfig,
    calculateDynamicLTV,
    createLoan,
    depositCollateral,
    withdrawCollateral,
    borrow,
    repay,
    liquidate,
    getLoanDetails,
    getUserLoans,
    getLoanEligibility,
    getLiquidationCandidates,
    getPoolStats
};
