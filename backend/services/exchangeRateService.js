const Currency = require('../models/Currency');

// In-memory cache for exchange rates
let rateCache = {
  rates: null,
  lastUpdated: null
};

// Configuration
const CACHE_TTL = parseInt(process.env.EXCHANGE_RATE_CACHE_TTL || '300000'); // 5 minutes default
const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const EXCHANGE_RATE_API = 'https://api.exchangerate-api.com/v4/latest/USD';

/**
 * Fetch crypto exchange rates from CoinGecko
 */
const fetchCryptoRatesFromCoinGecko = async () => {
  try {
    // Map of CoinGecko IDs to our currency codes
    const cryptoMapping = {
      'usd-coin': 'USDC',
      'tether': 'USDT',
      'ethereum': 'ETH',
      'bitcoin': 'BTC'
    };

    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=usd-coin,tether,ethereum,bitcoin&vs_currencies=usd`
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();
    const rates = {};

    for (const [coingeckoId, currencyCode] of Object.entries(cryptoMapping)) {
      if (data[coingeckoId] && data[coingeckoId].usd) {
        // CoinGecko gives us USD price, we need rate relative to USD (which is 1/USD price)
        rates[currencyCode] = 1 / data[coingeckoId].usd;
      }
    }

    return rates;
  } catch (error) {
    console.error('[ExchangeRateService] CoinGecko fetch error:', error.message);
    return null;
  }
};

/**
 * Fetch fiat exchange rates from ExchangeRate-API (free tier)
 */
const fetchFiatRatesFromExchangeRateApi = async () => {
  try {
    const response = await fetch(EXCHANGE_RATE_API);

    if (!response.ok) {
      throw new Error(`ExchangeRate-API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Extract only the currencies we support
    const supportedFiats = ['EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY'];
    const rates = { USD: 1 }; // Base currency

    for (const currency of supportedFiats) {
      if (data.rates[currency]) {
        // rate = 1 / (currency per USD)
        rates[currency] = 1 / data.rates[currency];
      }
    }

    return rates;
  } catch (error) {
    console.error('[ExchangeRateService] ExchangeRate-API fetch error:', error.message);
    return null;
  }
};

/**
 * Fetch all exchange rates from multiple sources
 */
const fetchAllExchangeRates = async () => {
  const [cryptoRates, fiatRates] = await Promise.all([
    fetchCryptoRatesFromCoinGecko(),
    fetchFiatRatesFromExchangeRateApi()
  ]);

  const rates = { ...fiatRates, ...cryptoRates };
  return rates;
};

/**
 * Update exchange rates in the database
 */
const updateExchangeRatesInDb = async (rates) => {
  try {
    const updates = Object.entries(rates).map(([currencyCode, rate]) => ({
      currencyCode,
      rate
    }));

    await Currency.bulkUpdateExchangeRates(updates);
    console.log('[ExchangeRateService] Exchange rates updated in database');
    return true;
  } catch (error) {
    console.error('[ExchangeRateService] Failed to update rates in DB:', error.message);
    return false;
  }
};

/**
 * Get cached rates or fetch fresh rates
 */
const getExchangeRates = async (forceRefresh = false) => {
  const now = Date.now();

  // Return cached rates if still valid
  if (!forceRefresh && 
      rateCache.rates && 
      rateCache.lastUpdated && 
      (now - rateCache.lastUpdated) < CACHE_TTL) {
    return rateCache.rates;
  }

  // Fetch fresh rates
  console.log('[ExchangeRateService] Fetching fresh exchange rates...');
  const rates = await fetchAllExchangeRates();

  if (rates && Object.keys(rates).length > 0) {
    // Update cache
    rateCache.rates = rates;
    rateCache.lastUpdated = now;

    // Update database in background (don't wait)
    updateExchangeRatesInDb(rates).catch(err => 
      console.error('[ExchangeRateService] Background DB update failed:', err)
    );

    return rates;
  }

  // If fetch failed, return cached rates even if expired
  if (rateCache.rates) {
    console.log('[ExchangeRateService] Using expired cache due to fetch failure');
    return rateCache.rates;
  }

  // Last resort: load from database
  console.log('[ExchangeRateService] Loading rates from database as fallback');
  const dbRates = await Currency.getExchangeRates();
  const ratesObj = {};
  for (const row of dbRates) {
    ratesObj[row.currency_code] = parseFloat(row.rate);
  }
  return ratesObj;
};

/**
 * Convert amount between currencies
 */
const convert = async (amount, fromCurrency, toCurrency) => {
  const rates = await getExchangeRates();

  const fromRate = rates[fromCurrency?.toUpperCase()];
  const toRate = rates[toCurrency?.toUpperCase()];

  if (!fromRate || !toRate) {
    throw new Error(`Exchange rate not found for ${fromCurrency} or ${toCurrency}`);
  }

  // Convert: amount -> USD -> target currency
  const amountInUsd = amount / fromRate;
  const convertedAmount = amountInUsd * toRate;
  const rate = toRate / fromRate;

  return {
    amount: convertedAmount,
    rate,
    fromCurrency: fromCurrency?.toUpperCase(),
    toCurrency: toCurrency?.toUpperCase()
  };
};

/**
 * Get exchange rate between two currencies
 */
const getRate = async (fromCurrency, toCurrency) => {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  const rates = await getExchangeRates();
  const fromRate = rates[fromCurrency?.toUpperCase()];
  const toRate = rates[toCurrency?.toUpperCase()];

  if (!fromRate || !toRate) {
    throw new Error(`Exchange rate not found for ${fromCurrency} or ${toCurrency}`);
  }

  return toRate / fromRate;
};

/**
 * Format amount with currency symbol
 */
const formatCurrency = (amount, currencyCode, locale = 'en-US') => {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch (error) {
    // Fallback formatting
    const symbols = {
      USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥',
      AUD: 'A$', CAD: 'C$', CHF: 'CHF', CNY: '¥', USDC: 'USDC', USDT: 'USDT'
    };
    const symbol = symbols[currencyCode] || currencyCode;
    return `${symbol}${amount.toFixed(2)}`;
  }
};

/**
 * Initialize exchange rates on service start
 */
const initializeExchangeRates = async () => {
  try {
    console.log('[ExchangeRateService] Initializing exchange rates...');
    const rates = await getExchangeRates(true); // Force refresh
    console.log('[ExchangeRateService] Exchange rates initialized:', Object.keys(rates).length, 'currencies');
    return rates;
  } catch (error) {
    console.error('[ExchangeRateService] Initialization failed:', error.message);
    // Load from database as fallback
    const dbRates = await Currency.getExchangeRates();
    const ratesObj = {};
    for (const row of dbRates) {
      ratesObj[row.currency_code] = parseFloat(row.rate);
    }
    rateCache.rates = ratesObj;
    rateCache.lastUpdated = Date.now();
    return ratesObj;
  }
};

/**
 * Start periodic rate updates
 */
const startRateUpdates = (intervalMs = CACHE_TTL) => {
  setInterval(async () => {
    try {
      await getExchangeRates(true);
    } catch (error) {
      console.error('[ExchangeRateService] Periodic update failed:', error.message);
    }
  }, intervalMs);
};

module.exports = {
  getExchangeRates,
  convert,
  getRate,
  formatCurrency,
  initializeExchangeRates,
  startRateUpdates,
  fetchAllExchangeRates,
  updateExchangeRatesInDb
};
