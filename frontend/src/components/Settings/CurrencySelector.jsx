import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api from '../../utils/api';

const CurrencySelector = ({ 
  value, 
  onChange, 
  label = 'Currency',
  showFiatOnly = false,
  showCryptoOnly = false,
  className = ''
}) => {
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    fetchCurrencies();
  }, [showFiatOnly, showCryptoOnly]);

  const fetchCurrencies = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (showFiatOnly) params.append('type', 'fiat');
      if (showCryptoOnly) params.append('type', 'crypto');
      
      const response = await api.get(`/currencies?${params.toString()}`);
      if (response.data.success) {
        setCurrencies(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch currencies:', error);
      toast.error('Failed to load currencies');
      // Fallback to default currencies
      setCurrencies([
        { code: 'USD', name: 'US Dollar', symbol: '$' },
        { code: 'EUR', name: 'Euro', symbol: '€' },
        { code: 'GBP', name: 'British Pound', symbol: '£' },
        { code: 'INR', name: 'Indian Rupee', symbol: '₹' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const filteredCurrencies = currencies.filter(currency =>
    currency.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    currency.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedCurrency = currencies.find(c => c.code === value);

  const handleSelect = (currency) => {
    onChange(currency.code);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      
      <button
        type="button"
        onClick={() => !loading && setIsOpen(!isOpen)}
        disabled={loading}
        className="relative w-full bg-white border border-gray-300 rounded-lg px-4 py-2.5 text-left cursor-pointer hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-finovate-blue-500 focus:border-finovate-blue-500 transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed"
      >
        {loading ? (
          <span className="text-gray-400">Loading currencies...</span>
        ) : selectedCurrency ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">{selectedCurrency.symbol}</span>
              <span className="font-medium">{selectedCurrency.code}</span>
              <span className="text-gray-500 text-sm">- {selectedCurrency.name}</span>
            </div>
          </div>
        ) : (
          <span className="text-gray-400">Select currency</span>
        )}
        
        <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
          <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <input
                type="text"
                placeholder="Search currencies..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-finovate-blue-500"
                autoFocus
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                  setSearchTerm('');
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          
          <div className="overflow-y-auto max-h-48">
            {filteredCurrencies.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-500 text-center">
                No currencies found
              </div>
            ) : (
              filteredCurrencies.map((currency) => (
                <button
                  key={currency.code}
                  type="button"
                  onClick={() => handleSelect(currency)}
                  className={`w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center justify-between transition-colors
                    ${value === currency.code ? 'bg-blue-50 text-blue-700' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg w-8 text-center">{currency.symbol}</span>
                    <div>
                      <div className="font-medium">{currency.code}</div>
                      <div className="text-xs text-gray-500">{currency.name}</div>
                    </div>
                  </div>
                  {value === currency.code && (
                    <svg className="h-5 w-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CurrencySelector;
