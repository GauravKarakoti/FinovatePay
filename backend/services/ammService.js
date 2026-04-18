const crypto = require('crypto');
const { pool } = require('../config/database');

const DEFAULT_FEE_BPS = 30n;
const BPS_DENOMINATOR = 10_000n;

const toBigInt = (value, fieldName) => {
    if (value === null || value === undefined || value === '') {
        throw new Error(`${fieldName} is required`);
    }

    try {
        return BigInt(value);
    } catch {
        throw new Error(`Invalid numeric value for ${fieldName}`);
    }
};

const sqrtBigInt = (value) => {
    if (value < 0n) {
        throw new Error('sqrt only works on non-negative values');
    }

    if (value < 2n) {
        return value;
    }

    let x0 = value;
    let x1 = (x0 + value / x0) >> 1n;

    while (x1 < x0) {
        x0 = x1;
        x1 = (x0 + value / x0) >> 1n;
    }

    return x0;
};

const makeId = (prefix, payload) => {
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    return `0x${prefix}${hash.slice(0, 62 - prefix.length)}`;
};

const normalizeAddress = (address) => {
    if (!address) return null;
    return String(address).toLowerCase();
};

const formatPair = (row) => {
    if (!row) return null;

    const reserveFractions = BigInt(row.reserve_fractions || 0);
    const reserveStable = BigInt(row.reserve_stable || 0);
    const price = reserveFractions === 0n ? 0n : (reserveStable * 10n ** 18n) / reserveFractions;

    return {
        ...row,
        reserve_fractions: reserveFractions.toString(),
        reserve_stable: reserveStable.toString(),
        total_lp_shares: BigInt(row.total_lp_shares || 0).toString(),
        fee_bps: Number(row.fee_bps),
        spot_price_1e18: price.toString()
    };
};

const getPairs = async ({ tokenId, limit = 20, offset = 0 } = {}) => {
    let query = 'SELECT * FROM amm_pairs WHERE is_active = TRUE';
    const params = [];
    let idx = 1;

    if (tokenId !== undefined && tokenId !== null) {
        query += ` AND token_id = $${idx++}`;
        params.push(String(tokenId));
    }

    query += ` ORDER BY updated_at DESC LIMIT $${idx++} OFFSET $${idx}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows.map(formatPair);
};

const getPairById = async (pairId) => {
    const result = await pool.query('SELECT * FROM amm_pairs WHERE pair_id = $1', [pairId]);
    return formatPair(result.rows[0]);
};

const getPairByTokenId = async (tokenId) => {
    const result = await pool.query(
        'SELECT * FROM amm_pairs WHERE token_id = $1 AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1',
        [String(tokenId)]
    );
    return formatPair(result.rows[0]);
};

const addLiquidity = async ({
    tokenId,
    fractionTokenAddress,
    stablecoinAddress,
    providerAddress,
    fractionAmount,
    stableAmount
}) => {
    const tId = String(tokenId);
    const provider = normalizeAddress(providerAddress);
    const fractionToken = normalizeAddress(fractionTokenAddress);
    const stablecoin = normalizeAddress(stablecoinAddress);

    const inFractions = toBigInt(fractionAmount, 'fractionAmount');
    const inStable = toBigInt(stableAmount, 'stableAmount');
    if (inFractions <= 0n || inStable <= 0n) {
        throw new Error('Liquidity amounts must be positive');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pairLookup = await client.query(
            'SELECT * FROM amm_pairs WHERE token_id = $1 AND fraction_token_address = $2 AND stablecoin_address = $3 FOR UPDATE',
            [tId, fractionToken, stablecoin]
        );

        let pair = pairLookup.rows[0];
        if (!pair) {
            const pairId = makeId('ap', `${tId}:${fractionToken}:${stablecoin}`);
            const initialShares = sqrtBigInt(inFractions * inStable);
            if (initialShares <= 0n) {
                throw new Error('Insufficient initial liquidity');
            }

            const created = await client.query(
                `INSERT INTO amm_pairs (
                    pair_id, token_id, fraction_token_address, stablecoin_address,
                    reserve_fractions, reserve_stable, total_lp_shares, fee_bps, created_by
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 RETURNING *`,
                [
                    pairId,
                    tId,
                    fractionToken,
                    stablecoin,
                    inFractions.toString(),
                    inStable.toString(),
                    initialShares.toString(),
                    Number(DEFAULT_FEE_BPS),
                    provider
                ]
            );
            pair = created.rows[0];

            const positionId = makeId('lp', `${pairId}:${provider}`);
            const position = await client.query(
                `INSERT INTO liquidity_positions (
                    position_id, pair_id, provider_address, lp_shares,
                    total_fraction_added, total_stable_added
                 ) VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (pair_id, provider_address) DO UPDATE SET
                    lp_shares = liquidity_positions.lp_shares + EXCLUDED.lp_shares,
                    total_fraction_added = liquidity_positions.total_fraction_added + EXCLUDED.total_fraction_added,
                    total_stable_added = liquidity_positions.total_stable_added + EXCLUDED.total_stable_added
                 RETURNING *`,
                [
                    positionId,
                    pairId,
                    provider,
                    initialShares.toString(),
                    inFractions.toString(),
                    inStable.toString()
                ]
            );

            await client.query('COMMIT');
            return {
                pair: formatPair(pair),
                sharesMinted: initialShares.toString(),
                position: position.rows[0]
            };
        }

        const reserveFractions = BigInt(pair.reserve_fractions);
        const reserveStable = BigInt(pair.reserve_stable);
        const totalLpShares = BigInt(pair.total_lp_shares);

        let sharesMinted;

        // If the pool was completely drained, treat it like initial liquidity
        if (totalLpShares === 0n) {
            sharesMinted = sqrtBigInt(inFractions * inStable);
        } else {
            // Normal proportional liquidity addition
            const sharesFromFractions = (inFractions * totalLpShares) / reserveFractions;
            const sharesFromStable = (inStable * totalLpShares) / reserveStable;
            sharesMinted = sharesFromFractions < sharesFromStable ? sharesFromFractions : sharesFromStable;
        }

        if (sharesMinted <= 0n) {
            throw new Error('Liquidity contribution too small');
        }

        const nextFractions = reserveFractions + inFractions;
        const nextStable = reserveStable + inStable;
        const nextShares = totalLpShares + sharesMinted;

        const updatedPairResult = await client.query(
            `UPDATE amm_pairs
             SET reserve_fractions = $1,
                 reserve_stable = $2,
                 total_lp_shares = $3,
                 updated_at = NOW()
             WHERE pair_id = $4
             RETURNING *`,
            [
                nextFractions.toString(),
                nextStable.toString(),
                nextShares.toString(),
                pair.pair_id
            ]
        );

        const positionId = makeId('lp', `${pair.pair_id}:${provider}`);
        const position = await client.query(
            `INSERT INTO liquidity_positions (
                position_id, pair_id, provider_address, lp_shares,
                total_fraction_added, total_stable_added
             ) VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (pair_id, provider_address) DO UPDATE SET
                lp_shares = liquidity_positions.lp_shares + EXCLUDED.lp_shares,
                total_fraction_added = liquidity_positions.total_fraction_added + EXCLUDED.total_fraction_added,
                total_stable_added = liquidity_positions.total_stable_added + EXCLUDED.total_stable_added,
                updated_at = NOW()
             RETURNING *`,
            [
                positionId,
                pair.pair_id,
                provider,
                sharesMinted.toString(),
                inFractions.toString(),
                inStable.toString()
            ]
        );

        await client.query('COMMIT');

        return {
            pair: formatPair(updatedPairResult.rows[0]),
            sharesMinted: sharesMinted.toString(),
            position: position.rows[0]
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const removeLiquidity = async ({ pairId, providerAddress, shares }) => {
    const provider = normalizeAddress(providerAddress);
    const burnShares = toBigInt(shares, 'shares');
    if (burnShares <= 0n) {
        throw new Error('Shares must be positive');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pairResult = await client.query('SELECT * FROM amm_pairs WHERE pair_id = $1 FOR UPDATE', [pairId]);
        if (pairResult.rows.length === 0) {
            throw new Error('AMM pair not found');
        }

        const positionResult = await client.query(
            'SELECT * FROM liquidity_positions WHERE pair_id = $1 AND provider_address = $2 FOR UPDATE',
            [pairId, provider]
        );
        if (positionResult.rows.length === 0) {
            throw new Error('Liquidity position not found');
        }

        const pair = pairResult.rows[0];
        const position = positionResult.rows[0];

        const reserveFractions = BigInt(pair.reserve_fractions);
        const reserveStable = BigInt(pair.reserve_stable);
        const totalLpShares = BigInt(pair.total_lp_shares);
        const providerShares = BigInt(position.lp_shares);

        if (providerShares < burnShares) {
            throw new Error('Insufficient LP shares');
        }

        const fractionOut = (burnShares * reserveFractions) / totalLpShares;
        const stableOut = (burnShares * reserveStable) / totalLpShares;

        if (fractionOut <= 0n || stableOut <= 0n) {
            throw new Error('Liquidity removal amount too small');
        }

        const nextPairFractions = reserveFractions - fractionOut;
        const nextPairStable = reserveStable - stableOut;
        const nextTotalShares = totalLpShares - burnShares;
        const nextProviderShares = providerShares - burnShares;

        const pairUpdate = await client.query(
            `UPDATE amm_pairs
             SET reserve_fractions = $1,
                 reserve_stable = $2,
                 total_lp_shares = $3,
                 updated_at = NOW()
             WHERE pair_id = $4
             RETURNING *`,
            [
                nextPairFractions.toString(),
                nextPairStable.toString(),
                nextTotalShares.toString(),
                pairId
            ]
        );

        const positionUpdate = await client.query(
            `UPDATE liquidity_positions
             SET lp_shares = $1,
                 total_fraction_removed = total_fraction_removed + $2,
                 total_stable_removed = total_stable_removed + $3,
                 updated_at = NOW()
             WHERE pair_id = $4 AND provider_address = $5
             RETURNING *`,
            [
                nextProviderShares.toString(),
                fractionOut.toString(),
                stableOut.toString(),
                pairId,
                provider
            ]
        );

        await client.query('COMMIT');

        return {
            pair: formatPair(pairUpdate.rows[0]),
            position: positionUpdate.rows[0],
            fractionAmount: fractionOut.toString(),
            stableAmount: stableOut.toString()
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const swap = async ({ pairId, traderAddress, side, amountIn, minAmountOut = 0, txHash = null, blockNumber = null }) => {
    const trader = normalizeAddress(traderAddress);
    const inAmount = toBigInt(amountIn, 'amountIn');
    const minOut = toBigInt(minAmountOut, 'minAmountOut');

    if (inAmount <= 0n) {
        throw new Error('Swap input must be positive');
    }

    if (!['BUY_FRACTIONS', 'SELL_FRACTIONS'].includes(side)) {
        throw new Error('Invalid swap side');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pairResult = await client.query('SELECT * FROM amm_pairs WHERE pair_id = $1 AND is_active = TRUE FOR UPDATE', [pairId]);
        if (pairResult.rows.length === 0) {
            throw new Error('AMM pair not found or inactive');
        }

        const pair = pairResult.rows[0];
        const feeBps = BigInt(pair.fee_bps || Number(DEFAULT_FEE_BPS));
        const reserveFractions = BigInt(pair.reserve_fractions);
        const reserveStable = BigInt(pair.reserve_stable);

        if (reserveFractions <= 0n || reserveStable <= 0n) {
            throw new Error('Insufficient pool liquidity');
        }

        const amountInWithFee = (inAmount * (BPS_DENOMINATOR - feeBps)) / BPS_DENOMINATOR;
        const feeAmount = inAmount - amountInWithFee;

        let amountOut;
        let nextFractions;
        let nextStable;

        if (side === 'BUY_FRACTIONS') {
            amountOut = (amountInWithFee * reserveFractions) / (reserveStable + amountInWithFee);
            if (amountOut <= 0n || amountOut >= reserveFractions) {
                throw new Error('Insufficient fraction liquidity for swap');
            }

            nextStable = reserveStable + inAmount;
            nextFractions = reserveFractions - amountOut;
        } else {
            amountOut = (amountInWithFee * reserveStable) / (reserveFractions + amountInWithFee);
            if (amountOut <= 0n || amountOut >= reserveStable) {
                throw new Error('Insufficient stable liquidity for swap');
            }

            nextFractions = reserveFractions + inAmount;
            nextStable = reserveStable - amountOut;
        }

        if (amountOut < minOut) {
            throw new Error('Slippage exceeded');
        }

        const pairUpdate = await client.query(
            `UPDATE amm_pairs
             SET reserve_fractions = $1,
                 reserve_stable = $2,
                 updated_at = NOW()
             WHERE pair_id = $3
             RETURNING *`,
            [nextFractions.toString(), nextStable.toString(), pairId]
        );

        const tradeId = makeId('tr', `${pairId}:${trader}:${Date.now()}:${Math.random()}`);
        const tradeResult = await client.query(
            `INSERT INTO trades (
                trade_id, pair_id, trader_address, side,
                amount_in, amount_out, fee_amount,
                reserve_fractions_after, reserve_stable_after,
                tx_hash, block_number
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [
                tradeId,
                pairId,
                trader,
                side,
                inAmount.toString(),
                amountOut.toString(),
                feeAmount.toString(),
                nextFractions.toString(),
                nextStable.toString(),
                txHash,
                blockNumber
            ]
        );

        await client.query('COMMIT');

        return {
            pair: formatPair(pairUpdate.rows[0]),
            trade: tradeResult.rows[0],
            amountOut: amountOut.toString(),
            feeAmount: feeAmount.toString()
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const getPositionsByProvider = async (providerAddress) => {
    const result = await pool.query(
        `SELECT p.*, ap.token_id, ap.reserve_fractions, ap.reserve_stable, ap.total_lp_shares
         FROM liquidity_positions p
         JOIN amm_pairs ap ON ap.pair_id = p.pair_id
         WHERE p.provider_address = $1
         ORDER BY p.updated_at DESC`,
        [normalizeAddress(providerAddress)]
    );

    return result.rows.map((row) => ({
        ...row,
        lp_shares: BigInt(row.lp_shares).toString(),
        total_fraction_added: BigInt(row.total_fraction_added).toString(),
        total_stable_added: BigInt(row.total_stable_added).toString(),
        total_fraction_removed: BigInt(row.total_fraction_removed).toString(),
        total_stable_removed: BigInt(row.total_stable_removed).toString(),
        reserve_fractions: BigInt(row.reserve_fractions).toString(),
        reserve_stable: BigInt(row.reserve_stable).toString(),
        total_lp_shares: BigInt(row.total_lp_shares).toString()
    }));
};

const getTrades = async ({ pairId, limit = 50, offset = 0 } = {}) => {
    let query = 'SELECT * FROM trades WHERE 1=1';
    const params = [];
    let idx = 1;

    if (pairId) {
        query += ` AND pair_id = $${idx++}`;
        params.push(pairId);
    }

    query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows.map((row) => ({
        ...row,
        amount_in: BigInt(row.amount_in).toString(),
        amount_out: BigInt(row.amount_out).toString(),
        fee_amount: BigInt(row.fee_amount).toString(),
        reserve_fractions_after: BigInt(row.reserve_fractions_after).toString(),
        reserve_stable_after: BigInt(row.reserve_stable_after).toString()
    }));
};

module.exports = {
    getPairs,
    getPairById,
    getPairByTokenId,
    addLiquidity,
    removeLiquidity,
    swap,
    getPositionsByProvider,
    getTrades
};
