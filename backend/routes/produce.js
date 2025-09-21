const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const pool = require('../config/database');
const produceController = require('../controllers/produceController');
const marketService = require('../services/marketService');

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

        // Enhance lots with live market data
        const lotsWithMarketPrice = await Promise.all(result.rows.map(async (lot) => {
            const marketPrice = await marketService.getPricePerKg(lot.produce_type);
            return {
                ...lot,
                // Override the 'price' field with the live market price.
                // If fetching fails, fallback to the original price stored in the DB, or 0.
                price: marketPrice !== null ? marketPrice : (lot.price / 50.75 || 0),
            };
        }));
        
        res.json(lotsWithMarketPrice);
    } catch (error) {
        console.error('Error getting available lots:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get producer's own lots
router.get('/lots/producer', authenticateToken, async (req, res) => {
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

router.get('/lots/seller', authenticateToken, produceController.getSellerLots);

// Get a specific produce lot by ID
router.get('/lots/:lotId', async (req, res) => {
  try {
    const { lotId } = req.params;
    
    const lotResult = await pool.query(
      'SELECT * FROM produce_lots WHERE lot_id = $1',
      [lotId]
    );
    
    if (lotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Produce lot not found' });
    }
    
    const transactionsResult = await pool.query(
      'SELECT * FROM produce_transactions WHERE lot_id = $1 ORDER BY created_at DESC',
      [lotId]
    );
    
    res.json({
      success: true,
      lot: lotResult.rows[0],
      transactions: transactionsResult.rows
    });
  } catch (error) {
    console.error('Error getting produce lot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new produce lot (syncs from blockchain)
router.post('/lots', authenticateToken, produceController.createProduceLot);

module.exports = router;