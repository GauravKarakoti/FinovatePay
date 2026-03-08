import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  addAMMLiquidity,
  executeAMMSwap,
  getAMMPairs,
  getAMMPositions,
  getAMMTrades,
  removeAMMLiquidity
} from '../../utils/api';

const formatNumber = (value, decimals = 4) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString(undefined, { maximumFractionDigits: decimals });
};

const AMMMarketplace = () => {
  const [pairs, setPairs] = useState([]);
  const [selectedPairId, setSelectedPairId] = useState('');
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [addForm, setAddForm] = useState({
    tokenId: '',
    fractionTokenAddress: '',
    stablecoinAddress: '',
    fractionAmount: '',
    stableAmount: ''
  });

  const [removeForm, setRemoveForm] = useState({
    pairId: '',
    shares: ''
  });

  const [swapForm, setSwapForm] = useState({
    pairId: '',
    side: 'BUY_FRACTIONS',
    amountIn: '',
    minAmountOut: '0'
  });

  const selectedPair = useMemo(
    () => pairs.find((pair) => pair.pair_id === selectedPairId) || null,
    [pairs, selectedPairId]
  );

  const refreshData = async () => {
    try {
      setIsLoading(true);
      const [pairsRes, positionsRes, tradesRes] = await Promise.all([
        getAMMPairs({ limit: 50 }),
        getAMMPositions(),
        getAMMTrades({ limit: 50, pairId: selectedPairId || undefined })
      ]);

      const nextPairs = pairsRes?.data?.pairs || [];
      setPairs(nextPairs);
      setPositions(positionsRes?.data?.positions || []);
      setTrades(tradesRes?.data?.trades || []);

      if (!selectedPairId && nextPairs.length > 0) {
        setSelectedPairId(nextPairs[0].pair_id);
      }
    } catch (error) {
      console.error('Failed loading AMM data:', error);
      toast.error(error?.response?.data?.error?.message || 'Failed to load AMM marketplace data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  useEffect(() => {
    if (!selectedPairId) return;

    const loadTradesForPair = async () => {
      try {
        const response = await getAMMTrades({ limit: 50, pairId: selectedPairId });
        setTrades(response?.data?.trades || []);
      } catch (error) {
        console.error('Failed loading trades for pair:', error);
      }
    };

    loadTradesForPair();
  }, [selectedPairId]);

  const handleAddLiquidity = async (e) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      const response = await addAMMLiquidity(addForm);
      toast.success(response?.data?.message || 'Liquidity added');
      setAddForm((prev) => ({ ...prev, fractionAmount: '', stableAmount: '' }));
      await refreshData();
    } catch (error) {
      console.error('Add liquidity failed:', error);
      toast.error(error?.response?.data?.error?.message || error?.response?.data?.error || 'Add liquidity failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveLiquidity = async (e) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      const response = await removeAMMLiquidity(removeForm);
      toast.success(response?.data?.message || 'Liquidity removed');
      setRemoveForm({ pairId: removeForm.pairId, shares: '' });
      await refreshData();
    } catch (error) {
      console.error('Remove liquidity failed:', error);
      toast.error(error?.response?.data?.error?.message || error?.response?.data?.error || 'Remove liquidity failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSwap = async (e) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      const response = await executeAMMSwap(swapForm);
      toast.success(response?.data?.message || 'Swap executed');
      setSwapForm((prev) => ({ ...prev, amountIn: '' }));
      await refreshData();
    } catch (error) {
      console.error('Swap failed:', error);
      toast.error(error?.response?.data?.error?.message || error?.response?.data?.error || 'Swap failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-emerald-50 to-cyan-50 border border-emerald-200 rounded-xl p-5">
        <h2 className="text-2xl font-bold text-gray-900">AMM Secondary Market</h2>
        <p className="text-sm text-gray-700 mt-1">
          Trade invoice fractions with continuous liquidity, add LP capital, and monitor pool activity.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">AMM Pairs</h3>
            <button
              type="button"
              onClick={refreshData}
              className="text-sm px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200"
            >
              Refresh
            </button>
          </div>

          {isLoading ? (
            <div className="text-sm text-gray-500">Loading pairs...</div>
          ) : pairs.length === 0 ? (
            <div className="text-sm text-gray-500">No AMM pairs found yet. Add first liquidity below.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-3">Token ID</th>
                    <th className="py-2 pr-3">Reserve Fractions</th>
                    <th className="py-2 pr-3">Reserve Stable</th>
                    <th className="py-2 pr-3">Spot Price</th>
                    <th className="py-2 pr-3">Pair</th>
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((pair) => (
                    <tr
                      key={pair.pair_id}
                      className={`border-b last:border-b-0 cursor-pointer ${selectedPairId === pair.pair_id ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
                      onClick={() => {
                        setSelectedPairId(pair.pair_id);
                        setRemoveForm((prev) => ({ ...prev, pairId: pair.pair_id }));
                        setSwapForm((prev) => ({ ...prev, pairId: pair.pair_id }));
                      }}
                    >
                      <td className="py-2 pr-3 font-medium">{pair.token_id}</td>
                      <td className="py-2 pr-3">{formatNumber(pair.reserve_fractions)}</td>
                      <td className="py-2 pr-3">{formatNumber(pair.reserve_stable)}</td>
                      <td className="py-2 pr-3">{formatNumber(Number(pair.spot_price_1e18) / 1e18, 6)}</td>
                      <td className="py-2 pr-3 text-xs text-gray-500">{pair.pair_id.slice(0, 12)}...</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Selected Pair</h3>
          {!selectedPair ? (
            <p className="text-sm text-gray-500">Select a pair to inspect pool stats.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p><span className="text-gray-500">Pair ID:</span> {selectedPair.pair_id}</p>
              <p><span className="text-gray-500">Token ID:</span> {selectedPair.token_id}</p>
              <p><span className="text-gray-500">Fractions:</span> {formatNumber(selectedPair.reserve_fractions)}</p>
              <p><span className="text-gray-500">Stable:</span> {formatNumber(selectedPair.reserve_stable)}</p>
              <p><span className="text-gray-500">Total LP Shares:</span> {formatNumber(selectedPair.total_lp_shares)}</p>
              <p><span className="text-gray-500">Fee:</span> {selectedPair.fee_bps} bps</p>
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleAddLiquidity} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 space-y-3">
          <h3 className="text-base font-semibold text-gray-900">Add Liquidity</h3>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Token ID"
            value={addForm.tokenId}
            onChange={(e) => setAddForm((prev) => ({ ...prev, tokenId: e.target.value }))}
            required
          />
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Fraction Token Address"
            value={addForm.fractionTokenAddress}
            onChange={(e) => setAddForm((prev) => ({ ...prev, fractionTokenAddress: e.target.value }))}
            required
          />
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Stablecoin Address"
            value={addForm.stablecoinAddress}
            onChange={(e) => setAddForm((prev) => ({ ...prev, stablecoinAddress: e.target.value }))}
            required
          />
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Fractions Amount"
            value={addForm.fractionAmount}
            onChange={(e) => setAddForm((prev) => ({ ...prev, fractionAmount: e.target.value }))}
            required
          />
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Stable Amount"
            value={addForm.stableAmount}
            onChange={(e) => setAddForm((prev) => ({ ...prev, stableAmount: e.target.value }))}
            required
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-emerald-600 text-white py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Add Liquidity'}
          </button>
        </form>

        <form onSubmit={handleRemoveLiquidity} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 space-y-3">
          <h3 className="text-base font-semibold text-gray-900">Remove Liquidity</h3>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Pair ID"
            value={removeForm.pairId}
            onChange={(e) => setRemoveForm((prev) => ({ ...prev, pairId: e.target.value }))}
            required
          />
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="LP Shares to Burn"
            value={removeForm.shares}
            onChange={(e) => setRemoveForm((prev) => ({ ...prev, shares: e.target.value }))}
            required
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-orange-500 text-white py-2 text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Remove Liquidity'}
          </button>
        </form>

        <form onSubmit={handleSwap} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 space-y-3">
          <h3 className="text-base font-semibold text-gray-900">Swap</h3>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Pair ID"
            value={swapForm.pairId}
            onChange={(e) => setSwapForm((prev) => ({ ...prev, pairId: e.target.value }))}
            required
          />
          <select
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={swapForm.side}
            onChange={(e) => setSwapForm((prev) => ({ ...prev, side: e.target.value }))}
          >
            <option value="BUY_FRACTIONS">BUY_FRACTIONS (Stable -{`>`} Fractions)</option>
            <option value="SELL_FRACTIONS">SELL_FRACTIONS (Fractions -{`>`} Stable)</option>
          </select>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Amount In"
            value={swapForm.amountIn}
            onChange={(e) => setSwapForm((prev) => ({ ...prev, amountIn: e.target.value }))}
            required
          />
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Min Amount Out"
            value={swapForm.minAmountOut}
            onChange={(e) => setSwapForm((prev) => ({ ...prev, minAmountOut: e.target.value }))}
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-cyan-600 text-white py-2 text-sm font-medium hover:bg-cyan-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Execute Swap'}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">My Liquidity Positions</h3>
          {positions.length === 0 ? (
            <p className="text-sm text-gray-500">No active liquidity positions.</p>
          ) : (
            <div className="space-y-3">
              {positions.map((position) => (
                <div key={position.position_id} className="border rounded-lg p-3 text-sm">
                  <p className="font-medium">Pair: {position.pair_id.slice(0, 14)}...</p>
                  <p className="text-gray-600">Token ID: {position.token_id}</p>
                  <p className="text-gray-600">LP Shares: {formatNumber(position.lp_shares)}</p>
                  <p className="text-gray-600">Added: {formatNumber(position.total_fraction_added)} frac / {formatNumber(position.total_stable_added)} stable</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Trades</h3>
          {trades.length === 0 ? (
            <p className="text-sm text-gray-500">No trades yet for this pair.</p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {trades.map((trade) => (
                <div key={trade.trade_id} className="border rounded-lg p-3 text-sm">
                  <p className="font-medium text-gray-900">{trade.side}</p>
                  <p className="text-gray-600">In: {formatNumber(trade.amount_in)}</p>
                  <p className="text-gray-600">Out: {formatNumber(trade.amount_out)}</p>
                  <p className="text-gray-600">Fee: {formatNumber(trade.fee_amount)}</p>
                  <p className="text-xs text-gray-500 mt-1">{new Date(trade.created_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AMMMarketplace;
