import { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import { toast } from 'sonner';

// ─── Small presentational helpers ────────────────────────────────────────────

const CHAIN_LABELS = {
  'polygon-pos':    'Polygon PoS',
  'polygon-zkevm':  'Polygon zkEVM',
  'katana':         'Katana',
  'finovate-cdk':   'FinovatePay CDK',
};

const PROTOCOL_LABELS = {
  uniswap_v3:  'Uniswap V3',
  curve:        'Curve Finance',
  waltbridge:   'WaltBridge',
  agglayer:     'AggLayer',
  katana_pool:  'Katana Pool',
  direct:       'Direct Transfer',
  coingecko:    'Market Rate',
};

const RISK_COLORS = {
  low:    'bg-green-100  text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high:   'bg-red-100    text-red-700',
};

function ScoreBadge({ score }) {
  const color =
    score >= 80 ? 'bg-green-500' :
    score >= 55 ? 'bg-yellow-500' :
                  'bg-red-500';
  return (
    <div className={`flex items-center justify-center w-12 h-12 rounded-full text-white font-bold text-sm ${color}`}>
      {score}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-28 bg-gray-100 rounded-xl" />
      ))}
    </div>
  );
}

function CongestionIndicator({ level }) {
  if (level == null) return null;
  const color = level < 40 ? 'bg-green-400' : level < 70 ? 'bg-yellow-400' : 'bg-red-400';
  const label = level < 40 ? 'Low'          : level < 70 ? 'Medium'         : 'High';
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {label} congestion ({level})
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * RouteSelector
 *
 * Displays all available cross-border payment routes ranked by an AI score,
 * lets the user select one (or auto-select the best), and optionally executes
 * the chosen route via the smart routing backend.
 *
 * Props
 * ─────
 * fromToken         {string}   Source currency symbol  (e.g. "USDC")
 * toToken           {string}   Destination currency    (e.g. "EURC")
 * amount            {number}   Transfer amount
 * fromChain         {string}   Source chain slug       (optional)
 * toChain           {string}   Destination chain slug  (optional)
 * onRouteSelected   {function} Called with the selected route object
 * onExecuted        {function} Called with { executionId } after execution starts
 * showExecuteButton {boolean}  Whether to show the "Execute" button (default false)
 */
export default function RouteSelector({
  fromToken,
  toToken,
  amount,
  fromChain,
  toChain,
  onRouteSelected,
  onExecuted,
  showExecuteButton = false,
}) {
  const [routes, setRoutes]         = useState([]);
  const [meta, setMeta]             = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [executing, setExecuting]   = useState(false);

  // Preference toggles
  const [priorities, setPriorities] = useState({
    prioritizeRate:  false,
    prioritizeFee:   false,
    prioritizeSpeed: false,
  });

  const fetchRoutes = useCallback(async () => {
    if (!fromToken || !toToken || !amount || amount <= 0) return;

    setLoading(true);
    setError(null);
    setRoutes([]);
    setSelectedId(null);

    try {
      const params = new URLSearchParams({
        fromToken,
        toToken,
        amount: String(amount),
        ...(fromChain && { fromChain }),
        ...(toChain   && { toChain   }),
        ...Object.fromEntries(
          Object.entries(priorities).filter(([, v]) => v).map(([k]) => [k, 'true']),
        ),
      });

      const { data } = await api.get(`/smart-routing/routes?${params}`);

      if (data.success) {
        setRoutes(data.routes ?? []);
        setMeta(data.meta ?? null);
        // Auto-select the recommended route
        const best = data.routes?.find(r => r.recommended);
        if (best) {
          setSelectedId(best.routeId);
          onRouteSelected?.(best);
        }
      }
    } catch (err) {
      const message = err.response?.data?.error ?? 'Failed to load payment routes';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [fromToken, toToken, amount, fromChain, toChain, priorities]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchRoutes();
  }, [fetchRoutes]);

  const handleSelect = (route) => {
    setSelectedId(route.routeId);
    onRouteSelected?.(route);
  };

  const handleAutoSelect = () => {
    const best = routes.find(r => r.recommended) ?? routes[0];
    if (best) {
      setSelectedId(best.routeId);
      onRouteSelected?.(best);
      toast.success('Best route selected automatically');
    }
  };

  const handlePriorityToggle = (key) => {
    setPriorities(prev => ({
      prioritizeRate:  false,
      prioritizeFee:   false,
      prioritizeSpeed: false,
      [key]: !prev[key],
    }));
  };

  const handleExecute = async () => {
    if (!selectedId) {
      toast.error('Please select a route first');
      return;
    }
    setExecuting(true);
    try {
      const { data } = await api.post('/smart-routing/execute', { routeId: selectedId });
      if (data.success) {
        toast.success('Payment route execution started');
        onExecuted?.({ executionId: data.executionId });
      }
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Failed to execute route');
    } finally {
      setExecuting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const congestionFrom = meta?.networkCongestion?.[meta?.fromChain ?? fromChain];
  const congestionTo   = meta?.networkCongestion?.[meta?.toChain   ?? toChain  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
        <div>
          <h3 className="text-base font-semibold text-gray-800">
            Payment Routes
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            AI-optimised paths for{' '}
            <span className="font-medium">{fromToken}</span>
            {' → '}
            <span className="font-medium">{toToken}</span>
            {amount ? ` · ${parseFloat(amount).toLocaleString()} ${fromToken}` : ''}
          </p>
        </div>

        {/* Priority toggles */}
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { key: 'prioritizeRate',  label: 'Best Rate'  },
            { key: 'prioritizeFee',   label: 'Low Fees'   },
            { key: 'prioritizeSpeed', label: 'Fastest'    },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handlePriorityToggle(key)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                priorities[key]
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-300 text-gray-600 hover:border-blue-400'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={handleAutoSelect}
            disabled={loading || routes.length === 0}
            className="text-xs px-3 py-1 rounded-full bg-indigo-50 border border-indigo-300 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 transition-colors"
          >
            Auto-Select Best
          </button>
        </div>
      </div>

      {/* Network congestion */}
      {(congestionFrom != null || congestionTo != null) && (
        <div className="flex flex-wrap gap-4 px-5 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
          {congestionFrom != null && (
            <span>
              {CHAIN_LABELS[meta?.fromChain] ?? meta?.fromChain ?? fromChain}:{' '}
              <CongestionIndicator level={congestionFrom} />
            </span>
          )}
          {congestionTo != null && meta?.toChain !== meta?.fromChain && (
            <span>
              {CHAIN_LABELS[meta?.toChain] ?? meta?.toChain ?? toChain}:{' '}
              <CongestionIndicator level={congestionTo} />
            </span>
          )}
        </div>
      )}

      {/* Body */}
      <div className="p-5 space-y-3">
        {loading && <Skeleton />}

        {!loading && error && (
          <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
            {error}
            <button
              onClick={fetchRoutes}
              className="ml-3 text-xs underline text-red-700 hover:text-red-900"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && routes.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">
            No routes found for this pair. Try changing the chain or token.
          </p>
        )}

        {!loading && routes.map((route) => {
          const isSelected  = selectedId === route.routeId;
          const protocolLbl = PROTOCOL_LABELS[route.protocol] ?? route.protocol;
          const chainPath   = route.fromChain === route.toChain
            ? CHAIN_LABELS[route.fromChain] ?? route.fromChain
            : `${CHAIN_LABELS[route.fromChain] ?? route.fromChain} → ${CHAIN_LABELS[route.toChain] ?? route.toChain}`;
          const tokenPath   = Array.isArray(route.path) ? route.path.join(' → ') : '';

          return (
            <div
              key={route.routeId}
              onClick={() => handleSelect(route)}
              className={`relative rounded-xl border-2 cursor-pointer transition-all p-4 ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 shadow-md'
                  : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
              }`}
            >
              {/* Recommended badge */}
              {route.recommended && (
                <span className="absolute top-3 right-3 text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full font-medium">
                  Recommended
                </span>
              )}

              <div className="flex items-start gap-4">
                {/* Score circle */}
                <ScoreBadge score={route.score ?? 0} />

                {/* Route details */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-800 text-sm">{protocolLbl}</span>
                    <span className="text-xs text-gray-400">{chainPath}</span>
                    {route.riskLevel && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RISK_COLORS[route.riskLevel]}`}>
                        {route.riskLevel} risk
                      </span>
                    )}
                  </div>

                  {tokenPath && (
                    <p className="text-xs text-gray-400 mb-2 truncate">{tokenPath}</p>
                  )}

                  {/* Metrics grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                    <div>
                      <span className="text-gray-400">You receive</span>
                      <p className="font-semibold text-gray-800">
                        {route.netOutput != null
                          ? `${parseFloat(route.netOutput).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${toToken}`
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-400">Total fee</span>
                      <p className="font-semibold text-gray-800">
                        {route.totalFee != null
                          ? `$${parseFloat(route.totalFee).toFixed(4)}`
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-400">Settlement</span>
                      <p className="font-semibold text-gray-800">
                        {route.estimatedTimeSeconds != null
                          ? route.estimatedTimeSeconds < 60
                            ? `~${route.estimatedTimeSeconds}s`
                            : `~${Math.round(route.estimatedTimeSeconds / 60)}m`
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-400">Rate</span>
                      <p className="font-semibold text-gray-800">
                        {route.rate != null
                          ? parseFloat(route.rate).toFixed(6)
                          : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Score breakdown bar */}
                  {route.scoreBreakdown && (
                    <div className="mt-2 flex gap-2">
                      {[
                        { label: 'Rate',  value: route.scoreBreakdown.rateScore,  color: 'bg-blue-400'   },
                        { label: 'Fee',   value: route.scoreBreakdown.feeScore,   color: 'bg-green-400'  },
                        { label: 'Speed', value: route.scoreBreakdown.speedScore, color: 'bg-purple-400' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="flex-1">
                          <div className="flex justify-between text-xs text-gray-400 mb-0.5">
                            <span>{label}</span>
                            <span>{value}</span>
                          </div>
                          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${color} rounded-full transition-all`}
                              style={{ width: `${value}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selected indicator */}
                <div className={`mt-1 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                  isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                }`}>
                  {isSelected && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      {routes.length > 0 && (
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
          <p className="text-xs text-gray-400">
            {routes.length} route{routes.length !== 1 ? 's' : ''} analysed
            {meta?.analyzedAt && (
              <> · updated {new Date(meta.analyzedAt).toLocaleTimeString()}</>
            )}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchRoutes}
              disabled={loading}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
            >
              Refresh
            </button>
            {showExecuteButton && (
              <button
                onClick={handleExecute}
                disabled={!selectedId || executing}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                {executing ? 'Executing…' : 'Execute Route'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
