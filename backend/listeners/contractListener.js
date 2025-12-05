const pool = require('../config/database');
const { getFractionTokenContract } = require('../config/blockchain');

async function listenForTokenization() {
    const contract = getFractionTokenContract();
    
    console.log("🎧 Listening for 'Tokenized' events...");

    // TWEAK: Event-Driven Architecture
    contract.on("Tokenized", async (invoiceHash, tokenId, totalSupply, faceValue, event) => {
        console.log(`🔔 Event Received: Invoice ${invoiceHash} -> Token ${tokenId}`);

        try {
            // Update DB only after Blockchain confirmation
            const query = `
                UPDATE invoices 
                SET token_id = $1, financing_status = 'listed', is_tokenized = true 
                WHERE invoice_hash = $2
            `;
            await pool.query(query, [tokenId.toString(), invoiceHash]);
            console.log(`✅ Database updated for Token ID: ${tokenId}`);
        } catch (err) {
            console.error("❌ DB Update Failed:", err);
        }
    });
}

module.exports = listenForTokenization;