import React, { useState, useEffect } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { Transak } from '@transak/transak-sdk';
import { TOKEN_ADDRESSES } from '../utils/constants';
import ERC20Artifact from '../../../deployed/ERC20.json';
import { toast } from 'sonner';

const FiatOnRamp = () => {
  const { address: walletAddress } = useAccount();
  const [amount, setAmount] = useState('100');

  // Fetch USDC Balance
  const { data: balanceData, refetch: fetchBalance, isLoading: isRefreshing } = useReadContract({
    address: TOKEN_ADDRESSES.USDC,
    abi: ERC20Artifact.abi,
    functionName: 'balanceOf',
    args: [walletAddress],
    query: {
        enabled: !!walletAddress,
        refetchInterval: 15000,
    }
  });

  const balance = balanceData ? formatUnits(balanceData, 6) : '0.00';

  const handleBuyCrypto = () => {
    if (!walletAddress) {
      toast.error("Please connect your wallet first");
      return;
    }

    const transakConfig = {
      apiKey: import.meta.env.VITE_TRANSAK_API_KEY || '4fcd6904-706b-4009-8bb2-91f8071f727c',
      environment: 'STAGING',
      defaultCryptoCurrency: 'USDC',
      walletAddress: walletAddress,
      themeColor: '2563EB',
      fiatAmount: amount,
      defaultFiatCurrency: 'USD',
      email: '',
      redirectURL: '',
      hostURL: window.location.origin,
      widgetHeight: '625px',
      widgetWidth: '500px',
      network: 'polygon'
    };

    const transak = new Transak(transakConfig);

    transak.init();

    // This will trigger when the user marks payment is made
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
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Wallet Balance</h3>
          <p className="text-sm text-gray-500">Manage your stablecoins</p>
        </div>
        <button
            onClick={() => fetchBalance()}
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
