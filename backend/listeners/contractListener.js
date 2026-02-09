const pool = require('../config/database');
const { getFractionTokenContract, getProvider } = require('../config/blockchain');
const EventSync = require('../models/EventSync');

/**
 * Process a single Tokenized event and update the database
 * @param {string} invoiceHash - The invoice hash from the event
 * @param {BigInt} tokenId - The token ID from the event
 * @param {BigInt} totalSupply - The total supply from the event
 * @param {BigInt} faceValue - The face value from the event
 * @param {number} blockNumber - The block number where the event occurred
 * @returns {Promise<boolean>} Success status
 */
async function processTokenizedEvent(invoiceHash, tokenId, totalSupply, faceValue, blockNumber) {
    const client = await pool.connect();
    
    try {
        // Start transaction for atomicity
        await client.query('BEGIN');
        
        // Check if this event was already processed (idempotency check)
        const checkQuery = `
            SELECT token_id FROM invoices 
            WHERE invoice_hash = $1 AND token_id IS NOT NULL
        `;
        const checkResult = await client.query(checkQuery, [invoiceHash]);
        
        if (checkResult.rows.length > 0) {
            console.log(`⚠️  Event already processed: Invoice ${invoiceHash} -> Token ${tokenId}`);
            await client.query('COMMIT');
            return true;
        }
        
        // Update invoice with tokenization data
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
        const updateResult = await client.query(updateQuery, [tokenId.toString(), invoiceHash]);
        
        if (updateResult.rows.length === 0) {
            console.warn(`⚠️  No invoice found with hash: ${invoiceHash}`);
            await client.query('ROLLBACK');
            return false;
        }
        
        // Update the last processed block number
        await EventSync.updateLastProcessedBlock('Tokenized', blockNumber);
        
        // Commit transaction
        await client.query('COMMIT');
        
        console.log(`✅ Database updated for Token ID: ${tokenId} at block ${blockNumber}`);
        return true;
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ DB Update Failed:", err);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Replay missed events from the blockchain
 * Fetches historical events from the last processed block to current block
 * @param {Contract} contract - The FractionToken contract instance
 * @param {number} fromBlock - Starting block number
 * @param {number} toBlock - Ending block number
 * @returns {Promise<number>} Number of events replayed
 */
async function replayMissedEvents(contract, fromBlock, toBlock) {
    console.log(`🔄 Replaying events from block ${fromBlock} to ${toBlock}...`);
    
    try {
        // Query historical events
        const filter = contract.filters.Tokenized();
        const events = await contract.queryFilter(filter, fromBlock, toBlock);
        
        console.log(`📦 Found ${events.length} Tokenized events to replay`);
        
        let successCount = 0;
        
        // Process each event sequentially to maintain order
        for (const event of events) {
            const { invoiceId, tokenId, totalSupply, faceValue } = event.args;
            const blockNumber = event.blockNumber;
            
            console.log(`🔄 Replaying: Invoice ${invoiceId} -> Token ${tokenId} (Block ${blockNumber})`);
            
            try {
                const success = await processTokenizedEvent(
                    invoiceId,
                    tokenId,
                    totalSupply,
                    faceValue,
                    blockNumber
                );
                
                if (success) {
                    successCount++;
                }
            } catch (err) {
                console.error(`❌ Failed to replay event at block ${blockNumber}:`, err);
                // Continue processing other events even if one fails
            }
        }
        
        console.log(`✅ Successfully replayed ${successCount}/${events.length} events`);
        return successCount;
        
    } catch (err) {
        console.error("❌ Event replay failed:", err);
        throw err;
    }
}

/**
 * Initialize event synchronization and start listening for new events
 * Implements event replay mechanism to catch up on missed events
 */
async function listenForTokenization() {
    try {
        // Initialize EventSync table
        await EventSync.initializeTable();
        
        const contract = getFractionTokenContract();
        const provider = getProvider();
        
        // Get current block number
        const currentBlock = await provider.getBlockNumber();
        console.log(`📍 Current blockchain block: ${currentBlock}`);
        
        // Get last processed block from database
        const lastProcessedBlock = await EventSync.getLastProcessedBlock('Tokenized');
        console.log(`📍 Last processed block: ${lastProcessedBlock}`);
        
        // Replay missed events if there's a gap
        if (lastProcessedBlock < currentBlock) {
            const fromBlock = lastProcessedBlock + 1;
            
            // Limit replay range to avoid Alchemy free tier limits (max 10 blocks)
            const maxBlockRange = 10;
            const toBlock = Math.min(fromBlock + maxBlockRange - 1, currentBlock);
            
            console.log(`🔄 Detected gap in event processing. Replaying from block ${fromBlock} to ${toBlock}...`);
            
            await replayMissedEvents(contract, fromBlock, toBlock);
            
            // Update last processed block even if we didn't replay all
            if (toBlock < currentBlock) {
                console.log(`⚠️  Large gap detected. Processed ${toBlock - fromBlock + 1} blocks. Remaining: ${currentBlock - toBlock} blocks.`);
                console.log(`   Run server again to continue processing remaining blocks.`);
            }
        } else {
            console.log(`✅ No missed events detected. Database is in sync.`);
        }
        
        console.log("🎧 Listening for new 'Tokenized' events...");
        
        // Listen for new events going forward
        contract.on("Tokenized", async (invoiceHash, tokenId, totalSupply, faceValue, event) => {
            console.log(`🔔 New Event Received: Invoice ${invoiceHash} -> Token ${tokenId}`);
            
            try {
                await processTokenizedEvent(
                    invoiceHash,
                    tokenId,
                    totalSupply,
                    faceValue,
                    event.log.blockNumber
                );
            } catch (err) {
                console.error("❌ Failed to process new event:", err);
                // Log error but don't crash the listener
            }
        });
        
        console.log("✅ Tokenization listener initialized successfully");
        
    } catch (err) {
        console.error("❌ Failed to initialize tokenization listener:", err);
        throw err;
    }
}

module.exports = listenForTokenization;