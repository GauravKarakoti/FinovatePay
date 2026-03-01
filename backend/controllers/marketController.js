const marketService = require('../services/marketService');
const errorResponse = require('../utils/errorResponse');

exports.getMarketPrices = async (req, res) => {
    try {
        const { crop, state } = req.query;
        if (!crop) {
            return errorResponse(res, 'The "crop" query parameter is required.', 400);
        }
        const prices = await marketService.fetchLivePrices(crop, state);
        res.json(prices);
    } catch (error) {
        console.error('Error fetching market prices:', error);
        return errorResponse(res, 'Failed to fetch market prices.', 500);
    }
};