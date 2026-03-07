import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api from '../../utils/api';

/**
 * CurrencyRouter - Smart routing component for currency conversion
 * Displays best routes and allows users to convert between stablecoins
 */
const CurrencyRouter = ({ 
  onClose, 
  defaultFromCurrency = 'USDC', 
  defaultToCurrency = 'USDT',
  defaultAmount = 1000 
}) => {
  const [fromCurrency, setFromCurrency] = useState(defaultFromCurrency);
  const [toCurrency, setToCurrency] = useState(defaultToCurrency);
  const [amount, setAmount] = useState(defaultAmount);
  const [quotes, setQuotes] = useState([]);
  const [bestRoute, setBestRoute] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConverting, setIsConverting] = useState(false);
  const [stablecoins, setStablecoins] = useState([
    { code: 'USDC', name: 'USD Coin' },
    { code: 'USDT', name: 'Tether' },
    { code: 'DAI', name: 'Dai Stablecoin' },
    { code: 'PYUSD', name: 'PayPal USD' },
    { code: 'EUROC', name: 'Euro Coin' }
  ]);

  // Fetch quotes when currencies or amount change
  useEffect(() => {
    const fetchQuotes = async () => {
      if (fromCurrency === toCurrency) {
        const fallbackQuotes = [{
          provider: 'direct',
          routeType: 'direct',
          path: fromCurrency,
          rate: 1,
          amountOut: parseFloat(amount),
          slippageBps: 0,
          estimatedTime: 'Instant'
        }];
        setQuotes(fallbackQuotes);
        setBestRoute(fallbackQuotes[0]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const response = await api.get(
          `/currencies/routes/quotes?from=${fromCurrency}&to=${toCurrency}&amount=${amount}`
        );
        
        if (response.data.success) {
          setQuotes(response.data.data);
          // First quote is the best (sorted by amountOut)
          if (response.data.data.length > 0) {
            setBestRoute(response.data.data[0]);
          }
        }
      } catch (error) {
        console.error('Failed to fetch quotes:', error);
        // Fallback to basic rate
        const fallbackQuotes = [{
          provider: 'coingecko',
          routeType: 'direct',
          path: `${fromCurrency} → ${toCurrency}`,
          rate: 1,
          amountOut: parseFloat(amount),
          slippageBps: 10,
          estimatedTime: '5-15 min'
        }];
        setQuotes(fallbackQuotes);
        setBestRoute(fallbackQuotes[0]);
      } finally {
        setIsLoading(false);
      }
    };

    // Debounce the API call
    const timeoutId = setTimeout(fetchQuotes, 500);
    return () => clearTimeout(timeoutId);
  }, [fromCurrency, toCurrency, amount]);

  const handleConvert = async () => {
    if (!bestRoute || isConverting) return;

    setIsConverting(true);
    try {
      const response = await api.post('/currencies/routes/convert', {
        amount: parseFloat(amount),
        from: fromCurrency,
        to: toCurrency
      });

      if (response.data.success) {
        toast.success(`Successfully converted ${amount} ${fromCurrency} to ${response.data.data.toAmount.toFixed(2)} ${toCurrency}`);
        if (onClose) onClose();
      }
    } catch (error) {
      console.error('Conversion failed:', error);
      toast.error('Conversion failed. Please try again.');
    } finally {
      setIsConverting(false);
    }
  };

  const swapCurrencies = () => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
  };

  const formatCurrency = (value, currency) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 6
    }).format(value);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl border border-gray-100">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center space-x-2">
            <div className="bg-blue-100 p-2 rounded-full">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-800">Smart Currency Router</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Amount Input */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Amount to Convert
          </label>
          <input
            type="number"
            min="1"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-finovate-blue-500 focus:border-finovate-blue-500 transition-all text-lg font-medium"
            placeholder="Enter amount"
          />
        </div>

        {/* Currency Selection */}
        <div className="flex items-center gap-4 mb-6">
          {/* From Currency */}
          <div className="flex-1">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              From
            </label>
            <select
              value={fromCurrency}
              onChange={(e) => setFromCurrency(e.target.value)}
              className="block w-full py-3 px-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-finovate-blue-500 focus:border-finovate-blue-500 transition-all text-lg font-medium bg-white"
            >
              {stablecoins.map((coin) => (
                <option key={coin.code} value={coin.code} disabled={coin.code === toCurrency}>
                  {coin.code} - {coin.name}
                </option>
              ))}
            </select>
          </div>

          {/* Swap Button */}
          <button
            onClick={swapCurrencies}
            className="mt-6 p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </button>

          {/* To Currency */}
          <div className="flex-1">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              To
            </label>
            <select
              value={toCurrency}
              onChange={(e) => setToCurrency(e.target.value)}
              className="block w-full py-3 px-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-finovate-blue-500 focus:border-finovate-blue-500 transition-all text-lg font-medium bg-white"
            >
              {stablecoins.map((coin) => (
                <option key={coin.code} value={coin.code} disabled={coin.code === fromCurrency}>
                  {coin.code} - {coin.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Best Route Display */}
        <div className="bg-blue-50 p-4 rounded-lg mb-6 border border-blue-100">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-semibold text-blue-800">Best Route</span>
            {bestRoute && (
              <span className="text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded-full">
                {bestRoute.provider}
              </span>
            )}
          </div>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <svg className="animate-spin h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          ) : bestRoute ? (
            <div>
              <div className="text-2xl font-bold text-blue-900 mb-1">
                {formatCurrency(bestRoute.amountOut, toCurrency)}
              </div>
              <div className="text-sm text-blue-700">
                via {bestRoute.path} • {bestRoute.estimatedTime}
              </div>
              {bestRoute.slippageBps > 0 && (
                <div className="text-xs text-gray-500 mt-1">
                  Est. slippage: {bestRoute.slippageBps / 100}%
                </div>
              )}
            </div>
          ) : (
            <div className="text-gray-500">No routes available</div>
          )}
        </div>

        {/* All Quotes */}
        {quotes.length > 1 && (
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">All Available Routes</h4>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {quotes.slice(0, 5).map((quote, index) => (
                <div 
                  key={index}
                  className={`p-3 rounded-lg border ${index === 0 ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'}`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-medium text-gray-800">{quote.path}</div>
                      <div className="text-xs text-gray-500">{quote.provider} • {quote.estimatedTime}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-gray-800">
                        {formatCurrency(quote.amountOut, toCurrency)}
                      </div>
                      {quote.slippageBps > 0 && (
                        <div className="text-xs text-gray-500">
                          -{quote.slippageBps / 100}%
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Convert Button */}
        <button
          onClick={handleConvert}
          disabled={isConverting || isLoading || fromCurrency === toCurrency || !bestRoute}
          className={`w-full py-3 px-4 rounded-lg shadow-lg text-white font-bold text-lg transition-all transform hover:-translate-y-0.5
            ${(isConverting || isLoading || fromCurrency === toCurrency)
              ? 'bg-gray-400 cursor-not-allowed shadow-none' 
              : 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 shadow-blue-500/30'}`}
        >
          {isConverting ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Converting...
            </span>
          ) : (
            `Convert ${amount} ${fromCurrency} → ${toCurrency}`
          )}
        </button>

        <p className="text-xs text-center text-gray-400 mt-4">
          Rates are estimated and may vary at execution time
        </p>
      </div>
    </div>
  );
};

export default CurrencyRouter;

