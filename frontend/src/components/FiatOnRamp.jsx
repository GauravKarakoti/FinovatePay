import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { stablecoinAddresses, erc20ABI, connectWallet } from '../utils/web3';

const FiatOnRamp = ({ walletAddress }) => {
  const [balance, setBalance] = useState('0.00');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchBalance = async () => {
    if (!walletAddress) return;

    setIsRefreshing(true);
    try {
      const { provider } = await connectWallet();
      const usdcAddress = stablecoinAddresses['USDC'];
      const contract = new ethers.Contract(usdcAddress, erc20ABI, provider);

      const rawBalance = await contract.balanceOf(walletAddress);
      const formattedBalance = ethers.formatUnits(rawBalance, 6);

      setBalance(formattedBalance);
    } catch (error) {
      // Catch the RPC error gracefully without crashing the console loop
      console.warn('Network congested or RPC failed while fetching balance. Retrying later.');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBalance();

    // Increase interval to 30 seconds to be kinder to public RPCs
    const interval = setInterval(fetchBalance, 30000); 
    return () => clearInterval(interval);
  }, [walletAddress]);

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

      <div>
        <div className="text-3xl font-bold text-gray-900 flex items-baseline">
          {balance} <span className="text-sm font-medium text-gray-500 ml-2">USDC</span>
        </div>
        <div className="text-xs text-gray-400 mt-1 font-mono break-all">
          {walletAddress || 'Not connected'}
        </div>
      </div>
    </div>
  );
};

export default FiatOnRamp;
