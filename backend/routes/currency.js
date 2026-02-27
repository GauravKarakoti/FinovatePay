const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const Currency = require('../models/Currency');
const exchangeRateService = require('../services/exchangeRateService');

/**
 * @swagger
 * /api/currencies:
 *   get:
 *     summary: Get all supported currencies
 *     tags: [Currencies]
 *     responses:
 *       200:
 *         description: List of supported currencies
 */
router.get('/', async (req, res, next) => {
  try {
    const { type, active } = req.query;
    let currencies;

    if (type === 'crypto') {
      currencies = await Currency.getCryptoCurrencies();
    } else if (type === 'fiat') {
      currencies = await Currency.getFiatCurrencies();
    } else {
      currencies = await Currency.getAll(active !== 'false');
    }

    res.json({
      success: true,
      data: currencies
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/currencies/{code}:
 *   get:
 *     summary: Get currency by code
 *     tags: [Currencies]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Currency details
 */
router.get('/:code', async (req, res, next) => {
  try {
    const currency = await Currency.getByCode(req.params.code);

    if (!currency) {
      return res.status(404).json({
        success: false,
        error: 'Currency not found'
      });
    }

    res.json({
      success: true,
      data: currency
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/currencies/exchange-rates:
 *   get:
 *     summary: Get current exchange rates
 *     tags: [Currencies]
 *     parameters:
 *       - in: query
 *         name: base
 *         schema:
 *           type: string
 *           default: USD
 *     responses:
 *       200:
 *         description: Current exchange rates
 */
router.get('/exchange-rates', async (req, res, next) => {
  try {
    const { base, forceRefresh } = req.query;
    
    let rates;
    if (forceRefresh === 'true') {
      rates = await exchangeRateService.getExchangeRates(true);
    } else {
      rates = await exchangeRateService.getExchangeRates();
    }

    // If base is not USD, convert all rates
    if (base && base !== 'USD') {
      const baseRate = rates[base];
      if (!baseRate) {
        return res.status(400).json({
          success: false,
          error: `Base currency ${base} not found`
        });
      }
      
      const convertedRates = {};
      for (const [code, rate] of Object.entries(rates)) {
        convertedRates[code] = rate / baseRate;
      }
      rates = convertedRates;
    }

    // Get currency details
    const currencies = await Currency.getAll();
    const currencyMap = {};
    currencies.forEach(c => {
      currencyMap[c.code] = c;
    });

    // Combine rates with currency details
    const response = Object.entries(rates).map(([code, rate]) => ({
      currencyCode: code,
      rate,
      ...currencyMap[code]
    }));

    res.json({
      success: true,
      data: response,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/currencies/convert:
 *   post:
 *     summary: Convert amount between currencies
 *     tags: [Currencies]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - from
 *               - to
 *             properties:
 *               amount:
 *                 type: number
 *               from:
 *                 type: string
 *               to:
 *                 type: string
 *     responses:
 *       200:
 *         description: Converted amount
 */
router.post('/convert', async (req, res, next) => {
  try {
    const { amount, from, to } = req.body;

    if (!amount || !from || !to) {
      return res.status(400).json({
        success: false,
        error: 'Amount, from, and to are required'
      });
    }

    const result = await exchangeRateService.convert(
      parseFloat(amount),
      from.toUpperCase(),
      to.toUpperCase()
    );

    res.json({
      success: true,
      data: {
        originalAmount: amount,
        convertedAmount: result.amount,
        rate: result.rate,
        from: result.fromCurrency,
        to: result.toCurrency
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/currencies/preferred:
 *   get:
 *     summary: Get user's preferred currency
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's preferred currency
 */
router.get('/preferred', authenticateToken, async (req, res, next) => {
  try {
    let preference = await Currency.getUserPreference(req.user.id);

    if (!preference) {
      // Get default currency
      const defaultCurrency = await Currency.getDefaultCurrency();
      preference = {
        preferred_currency: defaultCurrency?.code || 'USD',
        display_currency: defaultCurrency?.code || 'USD'
      };
    }

    res.json({
      success: true,
      data: preference
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/currencies/preferred:
 *   put:
 *     summary: Set user's preferred currency
 *     tags: [Currencies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               preferredCurrency:
 *                 type: string
 *               displayCurrency:
 *                 type: string
 *     responses:
 *       200:
 *         description: Preference updated
 */
router.put('/preferred', authenticateToken, async (req, res, next) => {
  try {
    const { preferredCurrency, displayCurrency } = req.body;

    // Validate currencies exist
    if (preferredCurrency) {
      const currency = await Currency.getByCode(preferredCurrency);
      if (!currency) {
        return res.status(400).json({
          success: false,
          error: `Currency ${preferredCurrency} not found`
        });
      }
    }

    if (displayCurrency) {
      const currency = await Currency.getByCode(displayCurrency);
      if (!currency) {
        return res.status(400).json({
          success: false,
          error: `Currency ${displayCurrency} not found`
        });
      }
    }

    const preference = await Currency.setUserPreference(
      req.user.id,
      preferredCurrency?.toUpperCase(),
      displayCurrency?.toUpperCase()
    );

    res.json({
      success: true,
      data: preference
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
