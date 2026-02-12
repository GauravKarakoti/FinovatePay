const { pool } = require('../config/database');
const { getFractionTokenContract } = require('../config/blockchain');
const { financeInvoice } = require('../services/financingService');

async function listenForTokenization() {
    const contract = getFractionTokenContract();
    
    console.log("🎧 Listening for 'Tokenized' events...");

    // TWEAK: Event-Driven Architecture
    contract.on("Tokenized", async (invoiceHash, tokenId, totalSupply, faceValue, event) => {
        console.log(`🔔 Event Received: Invoice ${invoiceHash} -> Token ${tokenId}`);

        try {
            // Update DB only after Blockchain confirmation
            // We update status to 'listed' first as an intermediate state
            const query = `
                UPDATE invoices 
                SET token_id = $1, financing_status = 'listed', is_tokenized = true 
                WHERE invoice_hash = $2
            `;
            await pool.query(query, [tokenId.toString(), invoiceHash]);
            console.log(`✅ Database updated for Token ID: ${tokenId} (Status: listed)`);

            // --- TRIGGER FINANCING PIPELINE ---
            // We pass faceValue as the amount to finance.
            // Converting BigInt to string for safety.
            const amount = faceValue.toString();

            // We pass null for sellerAddress so the service fetches it from DB
            await financeInvoice(invoiceHash, tokenId.toString(), null, amount);

        } catch (err) {
            console.error("❌ Error processing Tokenized event:", err);
        }
    });
}

module.exports = listenForTokenization;
