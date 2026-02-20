import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Transak } from '@transak/transak-sdk';
import { stablecoinAddresses, erc20ABI, connectWallet } from '../utils/web3';
import { toast } from 'sonner';

const FiatOnRamp = ({ walletAddress }) => {
  const [amount, setAmount] = useState('100'); // Default 100
  const [balance, setBalance] = useState('0.00');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch USDC Balance
  const fetchBalance = async () => {
    if (!walletAddress) return;

    setIsRefreshing(true);
    try {
      const { provider } = await connectWallet();
      // Use the USDC address from web3 utils
      const usdcAddress = stablecoinAddresses['USDC'];
      const contract = new ethers.Contract(usdcAddress, erc20ABI, provider);

      const rawBalance = await contract.balanceOf(walletAddress);
      const formattedBalance = ethers.formatUnits(rawBalance, 6); // USDC has 6 decimals

      setBalance(formattedBalance);
    } catch (error) {
      console.error('Error fetching balance:', error);
      // specific error handling if needed
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBalance();

    // Set up an interval to refresh balance occasionally
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  const handleBuyCrypto = () => {
    if (!walletAddress) {
      toast.error("Please connect your wallet first");
      return;
    }

    const apiKey = import.meta.env.VITE_TRANSAK_API_KEY || '4fcd6904-706b-4009-8bb2-91f8071f727c';
    
    // 1. Manually construct the widget URL with query parameters
    const baseUrl = 'https://global-stg.transak.com/'; 
    
    const queryParams = new URLSearchParams({
      apiKey: apiKey,
      defaultCryptoCurrency: 'USDC',
      walletAddress: walletAddress,
      themeColor: '2563EB',
      fiatAmount: amount.toString(),
      defaultFiatCurrency: 'USD',
      network: 'polygon'
    });

    // 2. Pass exactly what the TransakConfig type requires
    const transakConfig = {
      widgetUrl: `${baseUrl}?${queryParams.toString()}`,
      referrer: window.location.origin, 
      widgetHeight: '625px',
      widgetWidth: '500px',
    };

    const transak = new Transak(transakConfig);

    transak.init();

    // 3. Listen for successful transactions
    Transak.on(Transak.EVENTS.TRANSAK_ORDER_SUCCESSFUL, (orderData) => {
      console.log(orderData);
      toast.success("Transaction successful! Updating balance...");
      transak.close();

      // Poll for balance update
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        await fetchBalance();
        if (attempts >= 5) clearInterval(pollInterval);
      }, 3000);
    });

    // 4. ADD THIS: Listen for the user closing the widget
    Transak.on(Transak.EVENTS.TRANSAK_WIDGET_CLOSE, () => {
      console.log('Transak widget closed by user');
      transak.close(); // This physically removes the iframe from the DOM
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Wallet Balance</h3>
          <p className="text-sm text-gray-500">Manage your stablecoins</p>
        </div>
        <button
            onClick={fetchBalance}
            className={`p-1.5 rounded-full hover:bg-gray-100 transition-colors ${isRefreshing ? 'animate-spin' : ''}`}
            title="Refresh Balance"
        >
            🔄
        </button>
      </div>

      <div className="mb-6">
        <div className="text-3xl font-bold text-gray-900 flex items-baseline">
          {balance} <span className="text-sm font-medium text-gray-500 ml-2">USDC</span>
        </div>
        <div className="text-xs text-gray-400 mt-1 font-mono break-all">
          {walletAddress || 'Not connected'}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
            Buy Amount (USD)
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="number"
              name="amount"
              id="amount"
              className="focus:ring-blue-500 focus:border-blue-500 block w-full pl-7 pr-12 sm:text-sm border-gray-300 rounded-md py-2 border"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="10"
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="text-gray-500 sm:text-sm">USD</span>
            </div>
          </div>
        </div>

        <button
          onClick={handleBuyCrypto}
          disabled={!walletAddress}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Buy with Transak
        </button>
      </div>

      <div className="mt-4 text-xs text-center text-gray-400">
        Powered by Transak • Secure Payments
      </div>
    </div>
  );
};

export default FiatOnRamp;
