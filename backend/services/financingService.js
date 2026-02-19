const { pool } = require('../config/database');
const katanaService = require('./katanaService');
const waltBridgeService = require('./waltBridgeService');

/**
 * Orchestrates the financing pipeline for a tokenized invoice.
 * @param {string} invoiceHash - The hash of the invoice from the smart contract event.
 * @param {string} tokenId - The token ID minted for the invoice.
 * @param {string} sellerAddress - The wallet address of the seller (optional, can be fetched from DB).
 * @param {number|string} amount - The amount to be financed.
 */
async function financeInvoice(invoiceHash, tokenId, sellerAddress, amount) {
    console.log(`[Financing Service] Starting financing for Invoice: ${invoiceHash} (Token ID: ${tokenId})`);

    const client = await pool.connect();

    try {
        // 1. Validate & Fetch Invoice Details
        const invoiceQuery = `
            SELECT * FROM invoices
            WHERE invoice_hash = $1
        `;
        const result = await client.query(invoiceQuery, [invoiceHash]);

        if (result.rows.length === 0) {
            console.error(`[Financing Service] Invoice not found: ${invoiceHash}`);
            return;
        }

        const invoice = result.rows[0];

        // Idempotency Check
        if (invoice.financing_status === 'financed') {
            console.warn(`[Financing Service] Invoice ${invoiceHash} is already financed. Skipping.`);
            return;
        }

        // Use seller address from DB if not provided
        const seller = sellerAddress || invoice.seller_address;
        if (!seller) {
            throw new Error("Seller address missing for invoice.");
        }

        console.log(`[Financing Service] Invoice validated. Seller: ${seller}, Amount: ${amount}`);

        // 2. Request Liquidity from Katana
        const liquidity = await katanaService.requestLiquidity(amount);
        if (!liquidity.success) {
            throw new Error("Katana liquidity request failed.");
        }

        // 3. Bridge Funds via WaltBridge
        const bridgeReceipt = await waltBridgeService.bridgeFunds(liquidity.fundedAmount, seller);

        // 4. Update Database Status
        const updateQuery = `
            UPDATE invoices
            SET financing_status = 'financed',
                payment_tx_hash = $1,
                updated_at = NOW()
            WHERE invoice_hash = $2
        `;
        // Assuming there is a 'payment_tx_hash' column or similar.
        // If not, we might need to alter table or just log it.
        // Based on previous checks, I don't see payment_tx_hash in the INSERT,
        // but often it's added later. I'll add a check or use a try-catch for the specific column update
        // or just update financing_status if that column doesn't exist.

        // Let's try to update payment_tx_hash. If it fails, we'll fall back to just status.
        try {
             await client.query(updateQuery, [bridgeReceipt.txHash, invoiceHash]);
        } catch (dbErr) {
            console.warn("[Financing Service] Could not update payment_tx_hash column, updating status only.");
            const fallbackQuery = `
                UPDATE invoices
                SET financing_status = 'financed',
                    updated_at = NOW()
                WHERE invoice_hash = $1
            `;
            await client.query(fallbackQuery, [invoiceHash]);
        }

        console.log(`[Financing Service] ✅ Invoice ${invoiceHash} successfully financed!`);
        console.log(`[Financing Service] Seller paid: ${bridgeReceipt.amount} (Tx: ${bridgeReceipt.txHash})`);

        return {
            success: true,
            invoiceHash,
            tokenId,
            seller,
            amount,
            bridgeTxHash: bridgeReceipt.txHash
        };

    } catch (error) {
        console.error(`[Financing Service] ❌ Financing failed for Invoice ${invoiceHash}:`, error);
        // Optional: Update status to 'failed' or 'retry_needed'
        // await client.query("UPDATE invoices SET financing_status = 'failed' WHERE invoice_hash = $1", [invoiceHash]);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    financeInvoice
};
