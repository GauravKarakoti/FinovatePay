const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { pool } = require('../config/database');
const produceController = require('../controllers/produceController');
const marketService = require('../services/marketService');
const { 
  validateProduceLotId, 
  validateCreateProduceLot 
} = require('../middleware/validators');

router.get('/lots/available', authenticateToken, async (req, res) => {
    try {
        const query = `
          SELECT 
            pl.lot_id, pl.produce_type, pl.origin, pl.quantity AS initial_quantity,
            pl.current_quantity, pl.price, pl.quality_metrics, pl.farmer_address,
            u.email AS farmer_name
          FROM produce_lots pl
          JOIN users u ON pl.farmer_address = u.wallet_address
          WHERE pl.current_quantity > 0 
          ORDER BY pl.created_at DESC
        `;
        const result = await pool.query(query);

        // Enhance lots with live market data.
        // Fetch market prices per unique crop only once and reuse (reduces N external calls).
        const rows = result.rows || [];
        const uniqueCrops = [...new Set(rows.map(r => String(r.produce_type || '').toLowerCase()))].filter(Boolean);

        const pricePairs = await Promise.all(uniqueCrops.map(async (crop) => {
          const p = await marketService.getPricePerKg(crop).catch(() => null);
          return [crop, p];
        }));

        const priceMap = pricePairs.reduce((m, [c, p]) => { m[c] = p; return m; }, {});

        const lotsWithMarketPrice = rows.map(lot => {
          const cropKey = String(lot.produce_type || '').toLowerCase();
          const marketPrice = priceMap[cropKey];
          return {
            ...lot,
            price: marketPrice !== null && marketPrice !== undefined ? marketPrice : (lot.price / 50.75 || 0),
          };
        });

        res.json(lotsWithMarketPrice);
    } catch (error) {
        console.error('Error getting available lots:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get producer's own lots
router.get('/lots/producer', authenticateToken, requireRole(['seller', 'admin']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM produce_lots WHERE farmer_address = $1 ORDER BY created_at DESC',
      [req.user.wallet_address]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting producer lots:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/lots/seller', authenticateToken, requireRole(['seller', 'admin']), produceController.getSellerLots);

router.get('/lots/:lotId', authenticateToken, validateProduceLotId, async (req, res) => {
  try {
    const { lotId } = req.params;
    
    // 1. Get Lot Details
    const lotResult = await pool.query(
      'SELECT * FROM produce_lots WHERE lot_id = $1',
      [lotId]
    );
    
    if (lotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Produce lot not found' });
    }
    
    // 2. Get Lot Transactions
    const transactionsResult = await pool.query(
      'SELECT * FROM produce_transactions WHERE lot_id = $1 ORDER BY created_at DESC',
      [lotId]
    );
    
    // 3. (NEW) Get Location History
    const locationHistoryResult = await pool.query(
      'SELECT * FROM produce_location_history WHERE lot_id = $1 ORDER BY timestamp DESC',
      [lotId]
    );
    
    res.json({
      success: true,
      lot: lotResult.rows[0],
      transactions: transactionsResult.rows,
      locations: locationHistoryResult.rows // <-- Send locations to frontend
    });
  } catch (error) {
    console.error('Error getting produce lot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new produce lot (syncs from blockchain)
router.post('/lots', authenticateToken, requireRole(['seller', 'admin']), validateCreateProduceLot, produceController.createProduceLot);

module.exports = router;