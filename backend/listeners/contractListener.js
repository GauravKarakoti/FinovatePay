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
    totalFractions,
    pricePerFraction,
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

        await EventSync.updateLastProcessedBlock('InvoiceFractionalized', blockNumber);

        await client.query('COMMIT');

        console.log(`✅ Tokenized: ${invoiceHash} → Token ${tokenId}`);

        // --- TRIGGER FINANCING PIPELINE (POST-COMMIT) ---
        // Calculate face value: totalFractions * pricePerFraction
        const faceValue = BigInt(totalFractions) * BigInt(pricePerFraction);
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

async function replayMissedEvents(contract, fromBlock, toBlock) {
    console.log(`🔄 Replaying InvoiceFractionalized events from ${fromBlock} → ${toBlock}`);

    // Update the filter name here
    const filter = contract.filters.InvoiceFractionalized(); 
    const events = await contract.queryFilter(filter, fromBlock, toBlock);

    console.log(`📦 Found ${events.length} events`);

    let successCount = 0;

    for (const event of events) {
        // Destructure matching the Solidity event arguments
        const { invoiceId, tokenId, seller, totalFractions, pricePerFraction } = event.args;

        try {
            const success = await processTokenizedEvent(
                invoiceId,
                tokenId,
                totalFractions,
                pricePerFraction,
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
        const lastProcessedBlock = await EventSync.getLastProcessedBlock('InvoiceFractionalized');

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

        console.log("🎧 Listening for new InvoiceFractionalized events...");

        // Update event name and parameter list
        contract.on(
            "InvoiceFractionalized",
            async (invoiceId, tokenId, seller, totalFractions, pricePerFraction, event) => {
                try {
                    await processTokenizedEvent(
                        invoiceId,
                        tokenId,
                        totalFractions,
                        pricePerFraction, 
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