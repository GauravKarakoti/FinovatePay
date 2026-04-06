const express = require("express");
const router = express.Router();
const { authenticateToken, requireRole } = require("../middleware/auth");
const Invoice = require("../models/Invoice");
const { pool } = require("../config/database");
// Added getSigner to imports
const { getFractionTokenContract, getSigner } = require("../config/blockchain");

// Initialize for read-only operations (defaults to provider in blockchain.js)
const fractionToken = getFractionTokenContract();

router.post(
  "/record-investment",
  authenticateToken,
  requireRole(["investor", "admin"]),
  async (req, res) => {
    const { invoiceId, amountInvested, tokenId, txHash, paymentMethod } = req.body;
    const investorId = req.user.id;

    try {
      console.log(`Recording on-chain investment: Investor ${investorId}. Payment: ${paymentMethod}`);

      const investmentQuery = `
            INSERT INTO investments 
            (user_id, invoice_id, token_id, amount_invested, tokens_bought, status, tx_hash, payment_method, created_at)
            VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, NOW())
            RETURNING *;
        `;

      const pMethod = paymentMethod || "stablecoin";
      const values = [investorId, invoiceId, tokenId, amountInvested, amountInvested, txHash, pMethod];

      const { rows } = await pool.query(investmentQuery, values);
      const newInvestment = rows[0];

      const newSupply = await Invoice.decrementRemainingSupply(invoiceId, amountInvested);

      const io = req.app.get("io");
      io.to("marketplace").emit("investment-made", { invoiceId, newSupply });

      res.json({ msg: "Investment recorded successfully", investment: newInvestment, newSupply });
    } catch (err) {
      console.error("Failed to record investment:", err.message);
      if (err.code === "23505") return res.status(400).json({ msg: "Transaction already recorded." });
      res.status(500).send("Server Error");
    }
  }
);

// @route   GET /api/investor/portfolio
router.get("/portfolio", authenticateToken, requireRole(['investor', 'admin']), async (req, res) => {
  const investorWallet = req.user.wallet_address;
  console.log(`Fetching portfolio for investor: ${investorWallet}`);

  try {
    const tokenIdsResult = await pool.query(
      "SELECT token_id, id FROM invoices WHERE is_tokenized = TRUE AND token_id IS NOT NULL"
    );

    if (tokenIdsResult.rows.length === 0) return res.json([]);

    const tokenIds = tokenIdsResult.rows.map((r) => r.token_id);
    const invoiceIdMap = tokenIdsResult.rows.reduce((map, obj) => {
      map[obj.token_id] = obj.id;
      return map;
    }, {});

    const wallets = Array(tokenIds.length).fill(investorWallet);

    // This call works because fractionToken uses the default provider
    const balances = await fractionToken.balanceOfBatch(wallets, tokenIds);

    const portfolio = [];
    const nonZeroIndexes = balances
      .map((b, idx) => (b > 0n ? idx : -1)) // Ethers v6 uses BigInt for balances
      .filter(i => i !== -1);

    if (nonZeroIndexes.length === 0) return res.json([]);

    const invoiceIdsToFetch = nonZeroIndexes.map(i => invoiceIdMap[tokenIds[i]]);
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
    console.error("Portfolio Error:", err.message);
    res.status(500).json({ error: "Failed to fetch portfolio from blockchain" });
  }
});

// @route   POST /api/investor/redeem-tokens
router.post(
  "/redeem-tokens",
  authenticateToken,
  requireRole(['investor', 'admin']),
  async (req, res) => {
    const { tokenId, amount } = req.body;
    
    try {
      // 1. Await the signer (must be inside the async route)
      const signer = await getSigner();
      // 2. Connect the signer to the contract
      const contractWithSigner = fractionToken.connect(signer);

      console.log(`Attempting backend-signed redeem for Token ID ${tokenId}`);

      // 3. Ethers.js v6 syntax: Call the method directly. 
      // Do NOT use .send() or .estimateGas() as separate chains.
      const tx = await contractWithSigner.redeem(tokenId, amount);
      
      console.log(`Transaction submitted: ${tx.hash}`);
      const receipt = await tx.wait();

      // 4. Parse events using the contract interface
      const event = receipt.logs
        .map(log => {
            try { return fractionToken.interface.parseLog(log); } 
            catch (e) { return null; }
        })
        .find(e => e && e.name === 'Redeemed');

      const redeemedValue = event ? event.args.amount.toString() : amount;

      res.json({
        msg: "Tokens redeemed successfully",
        redeemed_value: redeemedValue,
        txHash: receipt.hash,
      });
    } catch (err) {
      console.error("Redemption Error:", err.message);
      res.status(500).json({ error: "Blockchain transaction failed", detail: err.message });
    }
  }
);

module.exports = router;