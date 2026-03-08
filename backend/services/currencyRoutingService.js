const { pool } = require('../config/database');
const exchangeRateService = require('./exchangeRateService');

// API Configuration
const BINANCE_API = 'https://api.binance.com/api/v3';
const UNISWAP_GRAPH = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Cache for routing quotes
let quoteCache = {
  quotes: [],
  lastUpdated: null
};

const CACHE_TTL = 30000; // 30 seconds

// Supported stablecoins
const STABLECOINS = ['USDC', 'USDT', 'DAI', 'PYUSD'];

/**
 * Get all available currency routes from database
 */
const getRoutesFromDb = async (fromCurrency, toCurrency) => {
  const query = `
    SELECT * FROM currency_routes
    WHERE from_currency = $1 AND to_currency = $2 AND is_active = TRUE
    ORDER BY priority DESC, rate ASC
  `;
  const { rows } = await pool.query(query, [fromCurrency.toUpperCase(), toCurrency.toUpperCase()]);
  return rows;
};

/**
 * Fetch real-time rates from multiple sources and find best route
 */
const fetchRealTimeRates = async (fromCurrency, toCurrency, amount) => {
  const routes = [];
  
  // Get database routes as baseline
  const dbRoutes = await getRoutesFromDb(fromCurrency, toCurrency);
  
  // 1. Try direct CoinGecko rate
  try {
    const directRate = await fetchDirectRate(fromCurrency, toCurrency);
    if (directRate) {
      routes.push({
        provider: 'coingecko',
        routeType: 'direct',
        path: [fromCurrency, toCurrency],
        rate: directRate,
        amountOut: amount * directRate,
        slippageBps: 10
      });
    }
  } catch (error) {
    console.log('[CurrencyRouting] Direct rate fetch failed:', error.message);
  }

  // 2. Try via USD route (for non-USD stablecoins)
  if (fromCurrency !== 'USD' && toCurrency !== 'USD') {
    try {
      const viaUsdRate = await fetchViaUsdRate(fromCurrency, toCurrency);
      if (viaUsdRate) {
        routes.push({
          provider: 'coingecko',
          routeType: 'via_usd',
          path: fromCurrency === 'USD' ? [toCurrency] : toCurrency === 'USD' ? [fromCurrency] : [fromCurrency, 'USD', toCurrency],
          rate: viaUsdRate,
          amountOut: amount * viaUsdRate,
          slippageBps: 20
        });
      }
    } catch (error) {
      console.log('[CurrencyRouting] Via USD rate fetch failed:', error.message);
    }
  }

  // 3. Try fetching from Binance for USDT pairs
  if (fromCurrency === 'USDT' || toCurrency === 'USDT') {
    try {
      const binanceRate = await fetchBinanceRate(fromCurrency, toCurrency);
      if (binanceRate) {
        routes.push({
          provider: 'binance',
          routeType: 'direct',
          path: [fromCurrency, toCurrency],
          rate: binanceRate,
          amountOut: amount * binanceRate,
          slippageBps: 5
        });
      }
    } catch (error) {
      console.log('[CurrencyRouting] Binance rate fetch failed:', error.message);
    }
  }

  // 4. Add database routes as fallback
  for (const dbRoute of dbRoutes) {
    routes.push({
      provider: dbRoute.provider,
      routeType: dbRoute.route_type,
      path: dbRoute.route_path ? JSON.parse(dbRoute.route_path) : [fromCurrency, toCurrency],
      rate: parseFloat(dbRoute.rate),
      amountOut: amount * parseFloat(dbRoute.rate),
      slippageBps: dbRoute.slippage_bps || 50
    });
  }

  return routes;
};

/**
 * Fetch direct rate from CoinGecko
 */
const fetchDirectRate = async (fromCurrency, toCurrency) => {
  // Map currency codes to CoinGecko IDs
  const currencyToId = {
    'USDC': 'usd-coin',
    'USDT': 'tether',
    'DAI': 'dai',
    'ETH': 'ethereum',
    'BTC': 'bitcoin',
    'PYUSD': 'paypal-usd'
  };

  const fromId = currencyToId[fromCurrency.toUpperCase()];
  const toId = currencyToId[toCurrency.toUpperCase()];

  if (!fromId || !toId) {
    return null;
  }

  try {
    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=${fromId}&vs_currencies=${toId.toLowerCase()}`
    );
    
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data[fromId]?.[toId.toLowerCase()] || null;
  } catch (error) {
    console.log('[CurrencyRouting] CoinGecko direct rate error:', error.message);
    return null;
  }
};

/**
 * Fetch rate via USD (two-hop through USD)
 */
const fetchViaUsdRate = async (fromCurrency, toCurrency) => {
  const rates = await exchangeRateService.getExchangeRates();
  
  const fromRate = rates[fromCurrency.toUpperCase()];
  const toRate = rates[toCurrency.toUpperCase()];

  if (!fromRate || !toRate) {
    return null;
  }

  // Convert: from -> USD -> to
  // If both are 1.0 (pegged), rate is 1.0
  return toRate / fromRate;
};

/**
 * Fetch rate from Binance API
 */
const fetchBinanceRate = async (fromCurrency, toCurrency) => {
  const symbol = `${fromCurrency}${toCurrency}`;
  const reverseSymbol = `${toCurrency}${fromCurrency}`;

  try {
    // Try direct symbol
    let response = await fetch(`${BINANCE_API}/ticker/price?symbol=${symbol}`);
    
    if (!response.ok) {
      // Try reverse
      response = await fetch(`${BINANCE_API}/ticker/price?symbol=${reverseSymbol}`);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      return 1 / parseFloat(data.price);
    }

    const data = await response.json();
    return parseFloat(data.price);
  } catch (error) {
    console.log('[CurrencyRouting] Binance rate error:', error.message);
    return null;
  }
};

/**
 * Find the best route for currency conversion
 */
const findBestRoute = async (fromCurrency, toCurrency, amount = 1000) => {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();

  // Same currency - no conversion needed
  if (from === to) {
    return {
      provider: 'none',
      routeType: 'direct',
      path: [from],
      rate: 1,
      amountOut: amount,
      slippageBps: 0
    };
  }

  // Get all available routes
  const routes = await fetchRealTimeRates(from, to, amount);

  if (routes.length === 0) {
    throw new Error(`No routes available for ${from} to ${to}`);
  }

  // Sort by amount out (highest first) - which means lowest effective rate
  routes.sort((a, b) => b.amountOut - a.amountOut);

  // Apply slippage to the best rate
  const bestRoute = routes[0];
  const slippageFactor = 1 - (bestRoute.slippageBps / 10000);
  bestRoute.slippageAdjustedAmountOut = bestRoute.amountOut * slippageFactor;

  return bestRoute;
};

/**
 * Get all conversion quotes from multiple providers
 */
const getQuotes = async (fromCurrency, toCurrency, amount) => {
  const now = Date.now();

  // Return cached quotes if still valid
  if (quoteCache.quotes && 
      quoteCache.lastUpdated && 
      (now - quoteCache.lastUpdated) < CACHE_TTL) {
    return quoteCache.quotes;
  }

  const routes = await fetchRealTimeRates(fromCurrency, toCurrency, amount);
  
  // Cache the results
  quoteCache.quotes = routes;
  quoteCache.lastUpdated = now;

  return routes;
};

/**
 * Convert amount using best route
 */
const convertWithRouting = async (amount, fromCurrency, toCurrency) => {
  const bestRoute = await findBestRoute(fromCurrency, toCurrency, amount);
  
  return {
    success: true,
    fromCurrency: fromCurrency.toUpperCase(),
    toCurrency: toCurrency.toUpperCase(),
    fromAmount: amount,
    toAmount: bestRoute.slippageAdjustedAmountOut || bestRoute.amountOut,
    rate: bestRoute.rate,
    provider: bestRoute.provider,
    routeType: bestRoute.routeType,
    path: bestRoute.path,
    slippageBps: bestRoute.slippageBps
  };
};

/**
 * Get supported stablecoins
 */
const getSupportedStablecoins = () => {
  return STABLECOINS;
};

/**
 * Get all currency routes from database
 */
const getAllRoutes = async () => {
  const query = `
    SELECT cr.*, c.name as from_name, c2.name as to_name
    FROM currency_rates cr
    JOIN currencies c ON c.code = cr.from_currency
    JOIN currencies c2 ON c2.code = cr.to_currency
    WHERE cr.is_active = TRUE
    ORDER BY cr.priority DESC
  `;
  
  try {
    const { rows } = await pool.query(query);
    return rows;
  } catch (error) {
    console.log('[CurrencyRouting] Error fetching routes:', error.message);
    return [];
  }
};

/**
 * Update route rates in database
 */
const updateRouteRates = async (routes) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    for (const route of routes) {
      await client.query(
        `UPDATE currency_routes
         SET rate = $1, last_updated = NOW()
         WHERE from_currency = $2 AND to_currency = $3 AND provider = $4`,
        [route.rate, route.fromCurrency, route.toCurrency, route.provider]
      );
    }

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.log('[CurrencyRouting] Error updating routes:', error.message);
    return false;
  } finally {
    client.release();
  }
};

/**
 * Save a multi-currency payment to database
 */
const savePayment = async (paymentData) => {
  const {
    transactionHash,
    fromCurrency,
    toCurrency,
    fromAmount,
    toAmount,
    rate,
    provider,
    routePath,
    userId,
    invoiceId,
    status = 'pending'
  } = paymentData;

  const query = `
    INSERT INTO multi_currency_payments 
    (transaction_hash, from_currency, to_currency, from_amount, to_amount, rate, provider, route_path, user_id, invoice_id, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id
  `;

  const values = [
    transactionHash,
    fromCurrency,
    toCurrency,
    fromAmount,
    toAmount,
    rate,
    provider,
    JSON.stringify(routePath),
    userId,
    invoiceId,
    status
  ];

  try {
    const { rows } = await pool.query(query, values);
    return rows[0];
  } catch (error) {
    console.log('[CurrencyRouting] Error saving payment:', error.message);
    throw error;
  }
};

/**
 * Update payment status
 */
const updatePaymentStatus = async (transactionHash, status) => {
  const query = `
    UPDATE multi_currency_payments
    SET status = $1, updated_at = NOW()
    WHERE transaction_hash = $2
    RETURNING *
  `;

  try {
    const { rows } = await pool.query(query, [status, transactionHash]);
    return rows[0];
  } catch (error) {
    console.log('[CurrencyRouting] Error updating payment status:', error.message);
    throw error;
  }
};

/**
 * Get payment by transaction hash
 */
const getPaymentByTxHash = async (transactionHash) => {
  const query = `
    SELECT * FROM multi_currency_payments
    WHERE transaction_hash = $1
  `;

  try {
    const { rows } = await pool.query(query, [transactionHash]);
    return rows[0];
  } catch (error) {
    console.log('[CurrencyRouting] Error getting payment:', error.message);
    throw error;
  }
};

/**
 * Get exchange quotes for display (with all available options)
 */
const getExchangeQuotes = async (fromCurrency, toCurrency, amount = 1000) => {
  const routes = await fetchRealTimeRates(fromCurrency, toCurrency, amount);
  
  // Apply slippage and sort
  return routes.map(route => ({
    provider: route.provider,
    routeType: route.routeType,
    path: route.path.join(' → '),
    rate: route.rate,
    amountOut: route.amountOut,
    amountOutWithSlippage: route.amountOut * (1 - route.slippageBps / 10000),
    slippageBps: route.slippageBps,
    estimatedTime: route.provider === 'binance' ? '1-5 min' : '5-15 min'
  })).sort((a, b) => b.amountOut - a.amountOut);
};

/**
 * Initialize routing service - warm up cache
 */
const initializeRouting = async () => {
  console.log('[CurrencyRouting] Initializing currency routing service...');
  
  // Pre-fetch routes for common pairs
  const commonPairs = [
    ['USDC', 'USDT'],
    ['DAI', 'USDC'],
    ['USDT', 'DAI'],
    ['PYUSD', 'USDC'],
    ['USDC', 'EUR'],
    ['EUR', 'USDC']
  ];

  for (const [from, to] of commonPairs) {
    try {
      await fetchRealTimeRates(from, to, 1000);
    } catch (error) {
      console.log(`[CurrencyRouting] Warning: Failed to warm up ${from}-${to} route`);
    }
  }

  console.log('[CurrencyRouting] Currency routing service initialized');
};

module.exports = {
  findBestRoute,
  getQuotes,
  convertWithRouting,
  getSupportedStablecoins,
  getAllRoutes,
  updateRouteRates,
  savePayment,
  updatePaymentStatus,
  getPaymentByTxHash,
  getExchangeQuotes,
  initializeRouting,
  fetchRealTimeRates
};

