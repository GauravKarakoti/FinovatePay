const { pool } = require('../config/database');
const { getFractionTokenContract, getProvider } = require('../config/blockchain');
const { financeInvoice } = require('../services/financingService');
const EventSync = require('../models/EventSync');

/**
 * Process a single Tokenized event and update the database
 */
async function processTokenizedEvent(
    invoiceHash,
    tokenId,
    totalSupply,
    faceValue,
    blockNumber
) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // --- IDEMPOTENCY CHECK ---
        const checkQuery = `
            SELECT token_id 
            FROM invoices 
            WHERE invoice_hash = $1 AND token_id IS NOT NULL
        `;
        const checkResult = await client.query(checkQuery, [invoiceHash]);

        if (checkResult.rows.length > 0) {
            console.log(`⚠️ Event already processed: ${invoiceHash}`);
            await client.query('COMMIT');
            return true;
        }

        // --- UPDATE INVOICE ---
        const updateQuery = `
            UPDATE invoices
            SET
                token_id = $1,
                financing_status = 'listed',
                is_tokenized = true,
                updated_at = CURRENT_TIMESTAMP
            WHERE invoice_hash = $2
            RETURNING *
        `;

        const updateResult = await client.query(updateQuery, [
            tokenId.toString(),
            invoiceHash
        ]);

        if (updateResult.rows.length === 0) {
            console.warn(`⚠️ No invoice found for hash: ${invoiceHash}`);
            await client.query('ROLLBACK');
            return false;
        }

        // --- UPDATE LAST PROCESSED BLOCK ---
        await EventSync.updateLastProcessedBlock('Tokenized', blockNumber);

        await client.query('COMMIT');

        console.log(`✅ Tokenized: ${invoiceHash} → Token ${tokenId}`);

        // --- TRIGGER FINANCING PIPELINE (POST-COMMIT) ---
        const amount = faceValue.toString();
        await financeInvoice(
            invoiceHash,
            tokenId.toString(),
            null, // sellerAddress resolved inside service
            amount
        );

        return true;

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Tokenized event processing failed:", err);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Replay missed Tokenized events
 */
async function replayMissedEvents(contract, fromBlock, toBlock) {
    console.log(`🔄 Replaying Tokenized events from ${fromBlock} → ${toBlock}`);

    const filter = contract.filters.Tokenized();
    const events = await contract.queryFilter(filter, fromBlock, toBlock);

    console.log(`📦 Found ${events.length} events`);

    let successCount = 0;

    for (const event of events) {
        const { invoiceId, tokenId, totalSupply, faceValue } = event.args;

        try {
            const success = await processTokenizedEvent(
                invoiceId,
                tokenId,
                totalSupply,
                faceValue,
                event.blockNumber
            );

            if (success) successCount++;
        } catch (err) {
            console.error(`❌ Replay failed at block ${event.blockNumber}`, err);
        }
    }

    console.log(`✅ Replayed ${successCount}/${events.length} events`);
    return successCount;
}

/**
 * Initialize tokenization event listener with replay support
 */
async function listenForTokenization() {
    try {
        await EventSync.initializeTable();

        const contract = getFractionTokenContract();
        const provider = getProvider();

        const currentBlock = await provider.getBlockNumber();
        const lastProcessedBlock = await EventSync.getLastProcessedBlock('Tokenized');

        console.log(`📍 Current block: ${currentBlock}`);
        console.log(`📍 Last processed block: ${lastProcessedBlock}`);

        if (lastProcessedBlock < currentBlock) {
            const fromBlock = lastProcessedBlock + 1;
            const maxBlockRange = 10;
            const toBlock = Math.min(fromBlock + maxBlockRange - 1, currentBlock);

            await replayMissedEvents(contract, fromBlock, toBlock);

            if (toBlock < currentBlock) {
                console.warn(
                    `⚠️ Partial replay (${fromBlock}-${toBlock}). Restart server to continue.`
                );
            }
        }

        console.log("🎧 Listening for new Tokenized events...");

        contract.on(
            "Tokenized",
            async (invoiceHash, tokenId, totalSupply, faceValue, event) => {
                try {
                    await processTokenizedEvent(
                        invoiceHash,
                        tokenId,
                        totalSupply,
                        faceValue,
                        event.log.blockNumber
                    );
                } catch (err) {
                    console.error("❌ Live event processing failed:", err);
                }
            }
        );

        console.log("✅ Tokenization listener ready");

    } catch (err) {
        console.error("❌ Failed to initialize listener:", err);
        throw err;
    }
}

module.exports = listenForTokenization;