const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const Invoice = require("../models/Invoice");
const { pool } = require("../config/database");
const { getSigner, getFractionTokenContract } = require("../config/blockchain");

const signer = getSigner();
const fractionToken = getFractionTokenContract(signer);

const isInvestor = (req, res, next) => {
  if (req.user.role !== "investor" && req.user.role !== "admin") {
    return res
      .status(403)
      .json({ msg: "Access denied. Investor role required." });
  }
  next();
};

router.post(
  "/record-investment",
  authenticateToken,
  isInvestor,
  async (req, res) => {
    // Added 'paymentMethod' to destructuring
    const { invoiceId, amountInvested, tokenId, txHash, paymentMethod } =
      req.body;
    const investorId = req.user.id;

    try {
      console.log(
        `Recording on-chain investment: Investor ${investorId} bought ${amountInvested} tokens. Payment: ${paymentMethod}`,
      );

      // FIX: Ensure 'payment_method' column exists in your 'investments' table schema
      const investmentQuery = `
            INSERT INTO investments 
            (user_id, invoice_id, token_id, amount_invested, tokens_bought, status, tx_hash, payment_method, created_at)
            VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, NOW())
            RETURNING *;
        `;

      // Default to 'stablecoin' if not provided
      const pMethod = paymentMethod || "stablecoin";

      const values = [
        investorId,
        invoiceId,
        tokenId,
        amountInvested,
        amountInvested,
        txHash,
        pMethod, // New value
      ];

      const { rows } = await pool.query(investmentQuery, values);
      const newInvestment = rows[0];

      const newSupply = await Invoice.decrementRemainingSupply(
        invoiceId,
        amountInvested,
      );

      const io = req.app.get("io");
      io.to("marketplace").emit("investment-made", {
        invoiceId,
        newSupply: newSupply,
      });

      res.json({
        msg: "Investment recorded successfully",
        investment: newInvestment,
        newSupply: newSupply,
      });
    } catch (err) {
      console.error("Failed to record investment:", err.message);
      if (err.code === "23505") {
        return res.status(400).json({ msg: "Transaction already recorded." });
      }
      res.status(500).send("Server Error");
    }
  },
);

router.post(
  "/record-redemption",
  authenticateToken,
  isInvestor,
  async (req, res) => {
    const { invoiceId, redeemedAmount, txHashes } = req.body;
    const investorAddress = req.user.wallet_address;

    if (!invoiceId || !redeemedAmount || !txHashes) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Update the investor's holdings to zero (or mark as redeemed)
      // This query assumes you want to set tokens_owned to 0 after redemption.
      // ** NOTE: This updates 'investor_holdings' table, but your investment route uses 'investments' table.
      //    You should verify these two tables are correct.
      const updateQuery = `
            UPDATE investor_holdings ih
            SET tokens_owned = 0
            FROM invoices i
            WHERE ih.invoice_id = i.id
              AND i.invoice_id = $1
              AND ih.investor_address = $2
        `;
      await client.query(updateQuery, [invoiceId, investorAddress]);

      // 2. Update the main invoice status to 'redeemed'
      // This assumes the *entire* invoice is redeemed, which might be a business logic choice.
      // You may want to check if all tokens are redeemed first.
      const updateInvoiceQuery = `
            UPDATE invoices
            SET financing_status = 'redeemed'
            WHERE invoice_id = $1
        `;
      await client.query(updateInvoiceQuery, [invoiceId]);

      // 3. (Optional) Log the redemption transaction
      // You might want a new table `redemptions` to log this.
      // e.g., INSERT INTO redemptions (invoice_id, investor_address, amount, tx_hashes) ...

      await client.query("COMMIT");
      res.status(200).json({ success: true, message: "Redemption recorded." });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error recording redemption:", error);
      res.status(500).json({ error: "Failed to record redemption." });
    } finally {
      client.release();
    }
  },
);

// @route   GET /api/investor/portfolio
// @desc    Get the investing portfolio for the logged-in investor
// @access  Private (Investor)
router.get("/portfolio", authenticateToken, isInvestor, async (req, res) => {
  console.log(`Fetching portfolio for investor: ${req.user.wallet_address}`);
  try {
    // --- WEB3 INTERACTION ---
    // You'd need a list of all possible token IDs (from the 'invoices' table)
    const tokenIdsResult = await pool.query(
      "SELECT token_id, id FROM invoices WHERE is_tokenized = TRUE AND token_id IS NOT NULL",
    );
    console.log(
      `Found ${tokenIdsResult.rows.length} tokenized invoices in the database.`,
    );
    if (tokenIdsResult.rows.length === 0) {
      return res.json([]); // No tokenized invoices exist yet
    }

    const tokenIds = tokenIdsResult.rows.map((r) => r.token_id);
    const invoiceIdMap = tokenIdsResult.rows.reduce((map, obj) => {
      map[obj.token_id] = obj.id;
      return map;
    }, {});

    const investorWallet = req.user.wallet_address;

    // Create an array of wallet addresses, one for each token ID
    const wallets = Array(tokenIds.length).fill(investorWallet);

    // Check balances for all tokens at once
    const balances = await fractionToken.balanceOfBatch(wallets, tokenIds);

    const portfolio = [];
    console.log(
      "Token balances fetched:",
      balances.map((b) => b.toString()),
    );

    // Collect non-zero balances and batch-fetch invoices in a single DB call
    const nonZeroIndexes = balances
      .map((b, idx) => (b.toString && b.toString() !== '0' ? idx : -1))
      .filter(i => i !== -1);

    const invoiceIdsToFetch = nonZeroIndexes
      .map(i => invoiceIdMap[tokenIds[i]])
      .filter(Boolean);

    const invoices = await Invoice.findByIds(invoiceIdsToFetch);
    const invoiceById = invoices.reduce((m, inv) => { m[inv.id] = inv; return m; }, {});

    for (const i of nonZeroIndexes) {
      const balance = balances[i].toString();
      const invoiceDbId = invoiceIdMap[tokenIds[i]];
      const invoice = invoiceById[invoiceDbId];
      if (invoice) {
        portfolio.push({
          invoice,
          tokens_owned: balance,
          token_id: tokenIds[i],
        });
      }
    }

    res.json(portfolio);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// @route   POST /api/investor/redeem-tokens
// @desc    Investor redeems tokens for a matured invoice
// @access  Private (Investor)
router.post(
  "/redeem-tokens",
  authenticateToken,
  isInvestor,
  async (req, res) => {
    const { tokenId, amount } = req.body;
    const investorWallet = req.user.wallet_address; // Corrected from walletAddress

    try {
      // 1. --- WEB3 INTERACTION ---
      // Ensure contract instance is ready
      if (!fractionToken) {
        return res
          .status(500)
          .json({ msg: "Blockchain service not initialized" });
      }

      console.log(
        `Attempting redeem: Investor ${investorWallet} redeeming ${amount} tokens of Token ID ${tokenId}`,
      );

      const gas = await fractionToken
        .redeem(tokenId, amount)
        .estimateGas({ from: investorWallet });

      const tx = await fractionToken
        .redeem(tokenId, amount)
        .send({ from: investorWallet, gas });

      const redemptionValue = tx.events.Redeemed.returnValues.amount;

      // 2. Update database (e.g., update the 'investments' table)
      console.log(
        `Redemption successful. Tx: ${tx.transactionHash}. Value: ${redemptionValue}`,
      );

      res.json({
        msg: "Tokens redeemed successfully",
        redeemed_value: redemptionValue,
        txHash: tx.transactionHash,
      });
    } catch (err) {
      console.error(err.message);
      // Handle common contract errors
      if (err.message.includes("Invoice not matured")) {
        return res
          .status(400)
          .json({ msg: "Redemption failed: Invoice has not matured yet." });
      }
      if (err.message.includes("Not enough tokens")) {
        return res
          .status(400)
          .json({ msg: "Redemption failed: Insufficient token balance." });
      }
      if (err.message.includes("reverted")) {
        return res
          .status(400)
          .json({
            msg: "Transaction failed. Check contract conditions (e.g., maturity, funds).",
          });
      }
      res.status(500).send("Server Error");
    }
  },
);

module.exports = router;
