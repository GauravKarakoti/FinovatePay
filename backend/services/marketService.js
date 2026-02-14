const axios = require('axios');
const { EXCHANGE_RATE } = require('../config/constants');

// NOTE: Add these to your .env file
const MARKET_API_KEY = process.env.MARKET_API_KEY;
const MARKET_API_URL = process.env.MARKET_API_URL || 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';

// Mock data as a fallback in case the live API fails
const mockMarketPrices = [
    { cropId: 'rice', cropName: 'Rice', price: 2500, unit: 'quintal', location: 'Delhi', date: new Date(), trend: 'up' },
    { cropId: 'wheat', cropName: 'Wheat', price: 2200, unit: 'quintal', location: 'Punjab', date: new Date(), trend: 'stable' }
];

/**
 * Fetches the latest market prices for a given crop.
 * @param {string} crop - The name of the crop (e.g., "Wheat").
 * @param {string} [state] - The optional state to filter by.
 * @returns {Promise<Array>} A promise that resolves to an array of market price objects.
 */
async function fetchLivePrices(crop, state) {
    try {
        const url = new URL(MARKET_API_URL);
        url.searchParams.set('api-key', MARKET_API_KEY);
        url.searchParams.set('format', 'json');
        url.searchParams.set('limit', '100'); // Fetch more records for a better average
        if (state && state.toLowerCase() !== 'all') url.searchParams.set('filters[state]', state);
        if (crop) url.searchParams.set('filters[commodity]', crop);

        const response = await axios.get(url.toString());
        const records = Array.isArray(response.data.records) ? response.data.records : [];
        if (records.length === 0) {
            throw new Error(`No market data found for crop: ${crop}`);
        }

        const mapped = records.map(r => {
            const modalPriceNum = Number(r?.modal_price);
            const minPriceNum = Number(r?.min_price);
            const maxPriceNum = Number(r?.max_price);
            const price = isFinite(modalPriceNum) && modalPriceNum > 0
                ? modalPriceNum
                : isFinite(minPriceNum) && isFinite(maxPriceNum)
                    ? Math.round((minPriceNum + maxPriceNum) / 2)
                    : 0;
            return {
                cropName: r?.commodity || 'Unknown',
                price, // Price per quintal
                unit: 'quintal',
                location: [r?.market, r?.district, r?.state].filter(Boolean).join(', ') || 'N/A',
            };
        }).filter(p => p.price / EXCHANGE_RATE > 0); // Filter out records with no valid price

        if (mapped.length === 0) throw new Error(`Could not determine a valid price for ${crop}`);
        
        return mapped;
    } catch (err) {
        console.warn('fetchLivePrices failed, using fallback:', err.message);
        // Fallback to mock data if the API fails
        return mockMarketPrices.filter(p => p.cropName.toLowerCase() === crop.toLowerCase());
    }
}

/**
 * Gets the most representative market price for a crop, converted to price per kg.
 * @param {string} crop - The name of the crop.
 * @returns {Promise<number|null>} The price per kg, or null if not found.
 */
async function getPricePerKg(crop) {
    if (!crop) return null;
    const prices = await fetchLivePrices(crop);
    if (prices.length === 0) return null;

    // Calculate the average price from all available records
    const total = prices.reduce((acc, p) => acc + (p.price / EXCHANGE_RATE), 0);
    const averagePricePerQuintal = total / prices.length;
    
    // Convert from quintal (100kg) to kg and format to 2 decimal places
    const pricePerKg = averagePricePerQuintal / 100;
    
    return parseFloat(pricePerKg.toFixed(2));
}

module.exports = { fetchLivePrices, getPricePerKg };