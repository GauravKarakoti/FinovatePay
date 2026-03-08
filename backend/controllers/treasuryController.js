const { ethers } = require('ethers');
const { getProvider, getSigner, contractAddresses, getTreasuryManagerContract } = require('../config/blockchain');
const errorResponse = require('../utils/errorResponse');

// GET /api/v1/treasury/balance
exports.getBalance = async (req, res) => {
  try {
    const provider = getProvider();
    const treasuryAddress = contractAddresses.treasuryManager;
    if (!treasuryAddress) return res.status(500).json({ error: 'Treasury address not configured' });

    const native = await provider.getBalance(treasuryAddress);

    // Optional token balances: query query param ?token=0x...
    const token = req.query.token;
    let tokenBalance = null;
    if (token) {
      const erc20 = new ethers.Contract(token, ['function balanceOf(address) view returns (uint256)'], provider);
      tokenBalance = await erc20.balanceOf(treasuryAddress);
    }

    res.json({ address: treasuryAddress, native: native.toString(), tokenBalance: tokenBalance ? tokenBalance.toString() : null });
  } catch (err) {
    console.error('treasury.getBalance error', err);
    return res.status(500).json(errorResponse(err));
  }
};

// POST /api/v1/treasury/withdraw
exports.postWithdraw = async (req, res) => {
  try {
    const { token, to, amount } = req.body;
    if (!to || !amount) return res.status(400).json({ error: 'Missing to or amount' });

    // Only governance/admin allowed (middleware should enforce). Use signer for tx submission.
    const signer = await getSigner();
    const treasury = getTreasuryManagerContract(signer);

    // Execute withdrawal via on-chain contract
    const tx = await treasury.executeWithdrawal(token || ethers.ZeroAddress, to, ethers.BigInt(amount));
    const receipt = await tx.wait();

    res.json({ success: true, txHash: receipt.transactionHash });
  } catch (err) {
    console.error('treasury.postWithdraw error', err);
    return res.status(500).json(errorResponse(err));
  }
};

// GET /api/v1/treasury/transactions
exports.getTransactions = async (req, res) => {
  try {
    const provider = getProvider();
    const treasuryAddress = contractAddresses.treasuryManager;
    if (!treasuryAddress) return res.status(500).json({ error: 'Treasury address not configured' });

    const fromBlock = req.query.fromBlock ? Number(req.query.fromBlock) : 0;
    const toBlock = req.query.toBlock ? Number(req.query.toBlock) : 'latest';

    // Filter for FeeCollected and WithdrawalExecuted events
    const treasuryAbi = getTreasuryManagerContract().interface;
    const feeFilter = treasuryAbi.getEvent('FeeCollected') ? treasuryAbi.getEvent('FeeCollected') : null;

    const logs = await provider.getLogs({ address: treasuryAddress, fromBlock, toBlock });
    // decode using contract interface
    const iface = getTreasuryManagerContract().interface;
    const decoded = logs.map((log) => {
      try {
        const parsed = iface.parseLog(log);
        return { name: parsed.name, args: parsed.args, txHash: log.transactionHash, blockNumber: log.blockNumber };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    res.json({ address: treasuryAddress, events: decoded });
  } catch (err) {
    console.error('treasury.getTransactions error', err);
    return res.status(500).json(errorResponse(err));
  }
};

// GET /api/v1/treasury/reports
exports.getReports = async (req, res) => {
  try {
    const provider = getProvider();
    const treasuryAddress = contractAddresses.treasuryManager;
    if (!treasuryAddress) return res.status(500).json({ error: 'Treasury address not configured' });

    // Simple on-chain aggregation: sum FeeCollected by token over recent blocks
    const toBlock = 'latest';
    const fromBlock = Math.max(0, (req.query.lookbackBlocks ? Number(req.query.lookbackBlocks) : 10000));

    const iface = getTreasuryManagerContract().interface;
    const logs = await provider.getLogs({ address: treasuryAddress, fromBlock, toBlock });

    const totals = {};
    for (const log of logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name === 'FeeCollected') {
          const token = parsed.args[0];
          const amount = parsed.args[2];
          totals[token] = (totals[token] || ethers.BigInt(0)) + ethers.BigInt(amount.toString());
        }
      } catch (e) {
        // ignore
      }
    }

    // Convert BigInts to strings
    const result = {};
    for (const k of Object.keys(totals)) result[k] = totals[k].toString();

    res.json({ address: treasuryAddress, totals: result });
  } catch (err) {
    console.error('treasury.getReports error', err);
    return res.status(500).json(errorResponse(err));
  }
};
