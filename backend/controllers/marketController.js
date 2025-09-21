const marketService = require('../services/marketService');

exports.getMarketPrices = async (req, res) => {
    try {
        const { crop, state } = req.query;
        if (!crop) {
            return res.status(400).json({ error: 'The "crop" query parameter is required.' });
        }
        const prices = await marketService.fetchLivePrices(crop, state);
        res.json(prices);
    } catch (error) {
        console.error('Error fetching market prices:', error);
        res.status(500).json({ error: 'Failed to fetch market prices.' });
    }
};