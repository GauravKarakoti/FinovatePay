/**
 * Smart Payment Routing Engine
 *
 * AI-powered routing service that analyses all available payment paths for a
 * cross-border transfer and selects the optimal route by weighing bridge fees,
 * exchange rates, and confirmation times across multiple DeFi protocols.
 *
 * Integration points:
 *   - currencyRoutingService  (DEX quotes, multi-hop paths, bridge fee matrix)
 *   - exchangeRateService     (fiat ↔ crypto rate pivot)
 *   - bridgeService           (BridgeAdapter / LiquidityAdapter on-chain execution)
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger')('smartRoutingService');
const currencyRoutingService = require('./currencyRoutingService');
const exchangeRateService = require('./exchangeRateService');
const bridgeService = require('./bridgeService');

// ─── Constants ────────────────────────────────────────────────────────────────

const ROUTE_CACHE_TTL = 30_000; // 30 s — matches currencyRoutingService

/** Supported execution protocols */
const PROTOCOLS = Object.freeze({
  UNISWAP_V3:   'uniswap_v3',
  CURVE:        'curve',
  WALTBRIDGE:   'waltbridge',
  KATANA_POOL:  'katana_pool',
  AGGLAYER:     'agglayer',
  DIRECT:       'direct',
  COINGECKO:    'coingecko',
});

/** Supported chains and their metadata */
const CHAINS = Object.freeze({
  'polygon-pos':   { name: 'Polygon PoS',      chainId: '137',   avgBlockTime: 2, nativeToken: 'MATIC' },
  'polygon-zkevm': { name: 'Polygon zkEVM',    chainId: '1101',  avgBlockTime: 5, nativeToken: 'ETH'   },
  'katana':        { name: 'Katana',            chainId: '51000', avgBlockTime: 3, nativeToken: 'ETH'   },
  'finovate-cdk':  { name: 'FinovatePay CDK',  chainId: '1001',  avgBlockTime: 2, nativeToken: 'MATIC' },
});

/**
 * Estimated bridge settlement time in seconds for each chain pair.
 * Directional — bridging A→B may differ from B→A.
 */
const BRIDGE_TIME_SECONDS = Object.freeze({
  'polygon-pos->katana':        120,
  'katana->polygon-pos':        180,
  'polygon-pos->polygon-zkevm': 300,
  'polygon-zkevm->polygon-pos': 300,
  'finovate-cdk->katana':        60,
  'katana->finovate-cdk':        90,
  'finovate-cdk->polygon-pos':  180,
  'polygon-pos->finovate-cdk':  150,
});

/**
 * Base gas cost per chain in USD equivalent (conservative estimate).
 */
const GAS_COST_USD = Object.freeze({
  'polygon-pos':   0.01,
  'polygon-zkevm': 0.05,
  'katana':        0.02,
  'finovate-cdk':  0.005,
  'ethereum':      5.0,
});

// ─── In-memory stores ─────────────────────────────────────────────────────────

/** routeId → { data, createdAt } */
const routeCache = new Map();

/** executionId → execution record */
const executionStore = new Map();

// ─── Custom Error ─────────────────────────────────────────────────────────────

class SmartRoutingError extends Error {
  constructor(message, code, originalError = null) {
    super(message);
    this.name = 'SmartRoutingError';
    this.code = code;
    this.originalError = originalError;
  }
}

// ─── Route Building ───────────────────────────────────────────────────────────

/**
 * Collect every possible route variant for the given payment parameters.
 *
 * Strategy:
 *   1. Same-chain DEX routes  (Uniswap V3 / Curve / CoinGecko quotes)
 *   2. Same-chain multi-hop   (via USDC / USDT / DAI / ETH)
 *   3. Cross-chain bridge     (WaltBridge + AggLayer variants)
 *   4. Cross-chain via Katana liquidity pool
 */
async function _buildRoutes({ fromToken, toToken, fromChain, toChain, amount }) {
  const routes = [];
  const isCrossChain = fromChain !== toChain;

  // ── 1. Same-chain DEX routes ─────────────────────────────────────────────
  if (!isCrossChain) {
    try {
      const dexRoutes = await currencyRoutingService.fetchRealTimeRates(fromToken, toToken, amount);
      for (const r of dexRoutes) {
        const protocol  = r.provider === 'binance' ? PROTOCOLS.UNISWAP_V3 : PROTOCOLS.COINGECKO;
        const gasFee    = GAS_COST_USD[fromChain] ?? 0.01;
        const totalFee  = gasFee;
        routes.push({
          protocol,
          provider:             r.provider,
          fromChain,
          toChain,
          fromToken,
          toToken,
          routeType:            r.routeType || 'direct',
          path:                 r.path,
          hops:                 (r.path?.length ?? 2) - 1,
          inputAmount:          amount,
          outputAmount:         r.amountOut,
          rate:                 r.rate,
          slippageBps:          r.slippageBps,
          bridgeFee:            0,
          gasFee,
          poolFee:              0,
          totalFee,
          netOutput:            r.amountOut - totalFee,
          estimatedTimeSeconds: r.provider === 'binance' ? 30 : 60,
        });
      }
    } catch (err) {
      logger.warn('DEX route fetch failed', { error: err.message });
    }
  }

  // ── 2. Multi-hop paths ───────────────────────────────────────────────────
  try {
    const hopPaths = await currencyRoutingService.getMultiHopPaths(fromToken, toToken, amount);
    for (const hop of hopPaths) {
      if (hop.hops <= 1) continue; // direct already covered above
      const gasFee   = (GAS_COST_USD[fromChain] ?? 0.01) * hop.hops;
      const totalFee = gasFee;
      routes.push({
        protocol:             PROTOCOLS.UNISWAP_V3,
        provider:             'uniswap_v3',
        fromChain,
        toChain,
        fromToken,
        toToken,
        routeType:            'multi_hop',
        path:                 hop.path,
        hops:                 hop.hops,
        inputAmount:          amount,
        outputAmount:         hop.outputAmount,
        rate:                 hop.rate,
        slippageBps:          hop.slippageBps,
        bridgeFee:            0,
        gasFee,
        poolFee:              0,
        totalFee,
        netOutput:            hop.outputAmount - totalFee,
        estimatedTimeSeconds: hop.hops * 45,
      });
    }
  } catch (err) {
    logger.warn('Multi-hop path fetch failed', { error: err.message });
  }

  // ── 3. Cross-chain bridge routes ─────────────────────────────────────────
  if (isCrossChain) {
    const bridgeKey   = `${fromChain}->${toChain}`;
    const bridgeTime  = BRIDGE_TIME_SECONDS[bridgeKey] ?? 300;
    const exchangeRate = await _safeGetRate(fromToken, toToken);

    // 3a. WaltBridge & AggLayer per fee spec
    try {
      const bridgeFees = await currencyRoutingService.estimateBridgeFees(
        fromChain, toChain, fromToken, amount,
      );
      for (const fee of bridgeFees) {
        const gasFee    = (GAS_COST_USD[fromChain] ?? 0.01) + (GAS_COST_USD[toChain] ?? 0.01);
        const totalFee  = fee.totalFee + gasFee;
        const netInput  = amount - fee.totalFee;
        const outputAmount = netInput * exchangeRate;
        routes.push({
          protocol:             fee.bridge === 'agglayer' ? PROTOCOLS.AGGLAYER : PROTOCOLS.WALTBRIDGE,
          provider:             fee.bridge,
          fromChain,
          toChain,
          fromToken,
          toToken,
          routeType:            'bridge_direct',
          path:                 [fromToken, toToken],
          hops:                 1,
          inputAmount:          amount,
          outputAmount,
          rate:                 exchangeRate,
          slippageBps:          15,
          bridgeFee:            fee.totalFee,
          gasFee,
          poolFee:              0,
          totalFee,
          netOutput:            outputAmount - gasFee,
          estimatedTimeSeconds: bridgeTime,
        });
      }
    } catch (err) {
      logger.warn('Bridge fee estimation failed', { error: err.message });
    }

    // 3b. Via Katana liquidity pool (lower latency, higher fee)
    if (toChain === 'katana' || fromChain === 'katana') {
      try {
        const poolFeeRate  = 0.0015;                     // 0.15 % pool fee
        const poolFee      = amount * poolFeeRate;
        const gasFee       = GAS_COST_USD['katana'] ?? 0.02;
        const totalFee     = poolFee + gasFee;
        const outputAmount = (amount - poolFee) * exchangeRate;
        const katanaBridgeTime = (BRIDGE_TIME_SECONDS[bridgeKey] ?? 300) * 0.65;
        routes.push({
          protocol:             PROTOCOLS.KATANA_POOL,
          provider:             'katana_pool',
          fromChain,
          toChain,
          fromToken,
          toToken,
          routeType:            'bridge_via_pool',
          path:                 [fromToken, 'WETH', toToken],
          hops:                 2,
          inputAmount:          amount,
          outputAmount,
          rate:                 exchangeRate,
          slippageBps:          20,
          bridgeFee:            poolFee * 0.5,
          gasFee,
          poolFee:              poolFee * 0.5,
          totalFee,
          netOutput:            outputAmount - gasFee,
          estimatedTimeSeconds: Math.round(katanaBridgeTime),
        });
      } catch (err) {
        logger.warn('Katana pool route failed', { error: err.message });
      }
    }
  }

  return routes;
}

/** Safe exchange rate lookup — falls back to 1.0 if both tokens are the same */
async function _safeGetRate(fromToken, toToken) {
  if (fromToken === toToken) return 1;
  try {
    return await exchangeRateService.getRate(fromToken, toToken);
  } catch (_) {
    try {
      const rates = await exchangeRateService.getExchangeRates();
      const from  = rates[fromToken] ?? 1;
      const to    = rates[toToken]   ?? 1;
      return to / from;
    } catch (__) {
      return 1;
    }
  }
}

// ─── Scoring & Ranking ────────────────────────────────────────────────────────

/**
 * Attach a composite score (0–100) to each route and sort best-first.
 *
 * Weights depend on optional user preferences:
 *   - prioritizeRate   → increase weight of output maximisation
 *   - prioritizeFee    → increase weight of cost minimisation
 *   - prioritizeSpeed  → increase weight speed
 */
function _scoreAndRank(routes, preferences = {}) {
  let w = {
    rate:  preferences.prioritizeRate  ? 0.60 : 0.40,
    fee:   preferences.prioritizeFee   ? 0.50 : 0.30,
    speed: preferences.prioritizeSpeed ? 0.50 : 0.30,
  };
  // Normalise so weights always sum to 1.0
  const wSum  = w.rate + w.fee + w.speed;
  w.rate  /= wSum;
  w.fee   /= wSum;
  w.speed /= wSum;

  const maxOutput = Math.max(...routes.map(r => r.outputAmount ?? 0), 1);
  const maxFee    = Math.max(...routes.map(r => r.totalFee     ?? 0), 1);
  const maxTime   = Math.max(...routes.map(r => r.estimatedTimeSeconds ?? 1), 1);

  return routes
    .map(route => {
      const rateScore  = (route.outputAmount            ?? 0)   / maxOutput;
      const feeScore   = 1 - (route.totalFee            ?? 0)   / maxFee;
      const speedScore = 1 - (route.estimatedTimeSeconds ?? 0)  / maxTime;

      const score     = Math.round((w.rate * rateScore + w.fee * feeScore + w.speed * speedScore) * 100);
      const riskLevel = route.hops > 2 ? 'high' : route.hops === 2 ? 'medium' : 'low';

      return {
        ...route,
        score,
        scoreBreakdown: {
          rateScore:  Math.round(rateScore  * 100),
          feeScore:   Math.round(feeScore   * 100),
          speedScore: Math.round(speedScore * 100),
        },
        riskLevel,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyse all available routes for a payment and return them ranked.
 *
 * @param {object} params
 * @param {string} params.fromToken        Source currency / token symbol  (e.g. "USDC")
 * @param {string} params.toToken          Destination currency / token symbol (e.g. "EURC")
 * @param {string} [params.fromChain]      Source chain slug  (defaults to "polygon-pos")
 * @param {string} [params.toChain]        Destination chain slug  (defaults to fromChain)
 * @param {number} params.amount           Transfer amount in fromToken units
 * @param {object} [params.preferences]    Scoring weight overrides
 * @returns {Promise<{routes, meta}>}
 */
async function analyzePaymentRoutes({ fromToken, toToken, fromChain, toChain, amount, preferences = {} }) {
  if (!fromToken || !toToken) throw new SmartRoutingError('fromToken and toToken are required', 'INVALID_PARAMS');
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
    throw new SmartRoutingError('amount must be a positive number', 'INVALID_AMOUNT');

  const from     = fromToken.toUpperCase();
  const to       = toToken.toUpperCase();
  const srcChain = fromChain || 'polygon-pos';
  const dstChain = toChain   || srcChain;
  const amt      = parseFloat(amount);

  const cacheKey = `${from}:${to}:${srcChain}:${dstChain}:${amt}`;
  const cached   = routeCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < ROUTE_CACHE_TTL) {
    logger.info(`[SmartRouting] Cache hit for ${cacheKey}`);
    return cached.data;
  }

  logger.info(`[SmartRouting] Analysing routes ${from}→${to} | ${srcChain}→${dstChain} | amount=${amt}`);

  const rawRoutes = await _buildRoutes({ fromToken: from, toToken: to, fromChain: srcChain, toChain: dstChain, amount: amt });

  if (rawRoutes.length === 0)
    throw new SmartRoutingError(`No routes found for ${from} → ${to} (${srcChain} → ${dstChain})`, 'NO_ROUTES');

  const [congestionSrc, congestionDst] = await Promise.all([
    currencyRoutingService.getNetworkCongestion(srcChain),
    currencyRoutingService.getNetworkCongestion(dstChain),
  ]);

  const scored = _scoreAndRank(rawRoutes, preferences);

  const routesWithIds = scored.map((route, idx) => ({
    routeId:     uuidv4(),
    rank:        idx + 1,
    recommended: idx === 0,
    ...route,
  }));

  // Store each route individually so it can be looked up by routeId
  const now = Date.now();
  for (const r of routesWithIds) {
    routeCache.set(r.routeId, { data: r, createdAt: now });
  }

  const result = {
    routes: routesWithIds,
    meta: {
      fromToken:     from,
      toToken:       to,
      fromChain:     srcChain,
      toChain:       dstChain,
      amount:        amt,
      analyzedAt:    new Date().toISOString(),
      networkCongestion: {
        [srcChain]: congestionSrc,
        [dstChain]: congestionDst,
      },
      bestRoute: routesWithIds[0] ?? null,
    },
  };

  routeCache.set(cacheKey, { data: result, createdAt: now });

  return result;
}

/**
 * Retrieve a previously analysed route by its routeId.
 * Returns null if the entry has expired or does not exist.
 */
function getRouteById(routeId) {
  const cached = routeCache.get(routeId);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > ROUTE_CACHE_TTL * 2) {
    routeCache.delete(routeId);
    return null;
  }
  return cached.data;
}

/**
 * Begin executing a selected route.
 * Returns an executionId immediately; the actual on-chain work runs in the background.
 *
 * @param {object} params
 * @param {string} params.routeId            ID returned by analyzePaymentRoutes
 * @param {string} params.userAddress        Wallet address of the initiating user
 * @param {number} [params.slippageTolerance] Max acceptable slippage in bps (default 50)
 * @returns {Promise<{executionId, status, message}>}
 */
async function executeRoute({ routeId, userAddress, slippageTolerance = 50 }) {
  if (!routeId)     throw new SmartRoutingError('routeId is required',     'INVALID_PARAMS');
  if (!userAddress) throw new SmartRoutingError('userAddress is required', 'INVALID_PARAMS');

  const route = getRouteById(routeId);
  if (!route) throw new SmartRoutingError('Route not found or expired. Please re-analyse.', 'ROUTE_NOT_FOUND');

  const executionId = uuidv4();
  const execution = {
    executionId,
    routeId,
    userAddress,
    slippageTolerance,
    status:    'pending',
    route,
    steps:     [],
    txHashes:  [],
    createdAt: new Date().toISOString(),
  };
  executionStore.set(executionId, execution);

  logger.info(`[SmartRouting] Starting execution ${executionId} | protocol=${route.protocol}`);

  // Fire-and-forget — status is polled via getExecutionStatus
  _executeAsync(executionId, route, userAddress).catch(err => {
    logger.error(`[SmartRouting] Execution ${executionId} failed`, { error: err.message });
    const exec = executionStore.get(executionId);
    if (exec) {
      exec.status   = 'failed';
      exec.error    = err.message;
      exec.failedAt = new Date().toISOString();
      executionStore.set(executionId, exec);
    }
  });

  return { executionId, status: 'pending', message: 'Route execution started' };
}

/**
 * Internal: execute the route steps sequentially.
 * Handles bridge and direct-DEX protocol pathways.
 */
async function _executeAsync(executionId, route, userAddress) {
  const exec = executionStore.get(executionId);
  exec.status = 'executing';
  executionStore.set(executionId, exec);

  const addStep = (step) => {
    exec.steps.push({ step, status: 'pending', startedAt: new Date().toISOString() });
    executionStore.set(executionId, exec);
    return exec.steps.length - 1;
  };

  const completeStep = (idx, txHash) => {
    exec.steps[idx].status      = 'completed';
    exec.steps[idx].completedAt = new Date().toISOString();
    if (txHash) {
      exec.steps[idx].txHash = txHash;
      exec.txHashes.push(txHash);
    }
    executionStore.set(executionId, exec);
  };

  // ── Bridge routes ──
  if (route.protocol === PROTOCOLS.WALTBRIDGE
   || route.protocol === PROTOCOLS.AGGLAYER
   || route.routeType === 'bridge_direct'
   || route.routeType === 'bridge_via_pool') {

    const stepIdx = addStep('bridge_lock');
    // Amount in smallest unit (USDC = 6 decimals)
    const amountBn = BigInt(Math.floor(route.inputAmount * 1e6));
    const result = await bridgeService.bridgeToKatana(
      route.fromToken,   // collateral tokenId for ERC1155 bridge   // used as a placeholder tokenId reference for ERC1155 bridge
      amountBn,
      userAddress,
    );
    completeStep(stepIdx, result.bridgeTxHash);
  }

  // ── Katana pool borrow route ──
  if (route.protocol === PROTOCOLS.KATANA_POOL) {
    const stepIdx = addStep('liquidity_pool_swap');
    // borrowFromKatana returns loanId + txHash
    const amountBn = BigInt(Math.floor(route.inputAmount * 1e6));
    const result = await bridgeService.borrowFromKatana(
      route.fromToken,
      amountBn,
      route.collateralTokenId,
    );
    completeStep(stepIdx, result.txHash);
  }

  // Finalise
  exec.status      = 'completed';
  exec.completedAt = new Date().toISOString();
  executionStore.set(executionId, exec);

  logger.info(`[SmartRouting] Execution ${executionId} completed`);
}

/**
 * Poll the status of a route execution.
 */
function getExecutionStatus(executionId) {
  const exec = executionStore.get(executionId);
  if (!exec) throw new SmartRoutingError('Execution record not found', 'NOT_FOUND');
  return exec;
}

/**
 * Return metadata about all supported protocols, chains, and bridge routes.
 */
function getSupportedProtocols() {
  return {
    protocols: Object.values(PROTOCOLS),
    chains:    CHAINS,
    bridgeRoutes: Object.entries(BRIDGE_TIME_SECONDS).map(([key, seconds]) => {
      const [fromChain, toChain] = key.split('->');
      return { fromChain, toChain, estimatedTimeSeconds: seconds };
    }),
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  analyzePaymentRoutes,
  getRouteById,
  executeRoute,
  getExecutionStatus,
  getSupportedProtocols,
  SmartRoutingError,
  PROTOCOLS,
  CHAINS,
};
