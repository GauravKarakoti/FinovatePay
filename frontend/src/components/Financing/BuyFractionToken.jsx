import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import {
  approveStablecoin,
  checkStablecoinAllowance,
  buyFractions,
  buyFractionsNative
} from '../../utils/web3';
import { toast } from 'react-hot-toast';

export const BuyFractionToken = ({
  tokenId,
  stablecoinAddress,
  stablecoinDecimals,
  tokenDecimals,
  maxAmount // Can be base units (BigInt, example: 0n) or formatted string
}) => {
  console.log("BuyFractionToken mounted with tokenId:", tokenId, "stablecoinAddress:", stablecoinAddress);
  
  const [amount, setAmount] = useState('');
  const [allowance, setAllowance] = useState(0n);
  const [isApproved, setIsApproved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAllowance, setIsCheckingAllowance] = useState(true);
  
  // State to toggle payment method
  const [useNativeToken, setUseNativeToken] = useState(false);
  console.log("Using native token for payment:", useNativeToken);

  // Helper to safely format the max amount for display
  const formatMaxAmount = () => {
    try {
      // If it's already a decimal string (e.g. "0.48"), return it as is
      if (typeof maxAmount === 'string' && maxAmount.includes('.')) {
        return maxAmount;
      }
      // Otherwise, assume it's base units and format it
      return ethers.formatUnits(maxAmount, tokenDecimals);
    } catch (error) {
      // Fallback to displaying as-is if formatting fails
      return maxAmount;
    }
  };

  const amountInBaseUnits = () => {
    console.log("Converting amount to base units:", amount, "with decimals:", tokenDecimals);
    try {
      return ethers.parseUnits(amount || '0', tokenDecimals);
    } catch {
      console.log("Error parsing amount:", amount, "with decimals:", tokenDecimals);
      return 0n;
    }
  };

  const amountToApprove = () => {
    console.log("Calculating amount to approve:", amount, "with decimals:", stablecoinDecimals);
    try {
      return ethers.parseUnits(amount || '0', stablecoinDecimals);
    } catch {
      console.log("Error parsing amount for approval:", amount, "with decimals:", stablecoinDecimals);
      return 0n;
    }
  };

  useEffect(() => {
    console.log("Checking stablecoin allowance...");
    // If using native token, we don't need to check stablecoin allowance
    if (useNativeToken) {
      setIsCheckingAllowance(false);
      setIsApproved(true); // Native tokens don't need approval
      console.log("Skipping stablecoin allowance check due to native token payment.");
      return;
    }

    console.log("Checking allowance for stablecoin:", stablecoinAddress);
    const checkAllowance = async () => {
      try {
        setIsCheckingAllowance(true);
        const currentAllowance = await checkStablecoinAllowance(stablecoinAddress);
        setAllowance(currentAllowance ?? 0n);
        console.log("Current allowance:", ethers.formatUnits(currentAllowance ?? 0n, stablecoinDecimals));
      } catch (err) {
        console.error("Failed to check allowance", err);
      } finally {
        setIsCheckingAllowance(false);
      }
    };
    checkAllowance();
  }, [stablecoinAddress, useNativeToken]);

  useEffect(() => {
    console.log("Re-evaluating approval status...");
    if (useNativeToken) return; // Skip logic if native

    if (!amount || isNaN(Number(amount))) {
      setIsApproved(false);
      console.log("Amount is invalid:", amount);
      return;
    }
    const needed = amountToApprove();
    setIsApproved(allowance >= needed);
    console.log("Is approved check:", allowance.toString(), "needed:", needed.toString());
  }, [amount, allowance, stablecoinDecimals, useNativeToken]);

  const handleApprove = async () => {
    console.log("Handling stablecoin approval for amount:", amount);
    setIsLoading(true);
    toast.loading("Waiting for approval...");
    try {
      const needed = amountToApprove();
      await approveStablecoin(stablecoinAddress, needed);
      setAllowance(needed); 
      setIsApproved(true);
      toast.dismiss();
      toast.success("Approved! You can now buy.");
    } catch (err) {
      toast.dismiss();
      toast.error("Approval failed or rejected.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBuy = async () => {
    console.log("Handling buy for tokenId:", tokenId, "amount:", amount, "using native token:", useNativeToken);
    setIsLoading(true);
    toast.loading("Processing purchase...");
    try {
      const amountToBuy = amountInBaseUnits();
      
      if (useNativeToken) {
        console.log("Purchased using native token.");
        await buyFractionsNative(tokenId, amountToBuy);
        console.log("buyFractionsNative called with tokenId:", tokenId, "amount:", amountToBuy.toString());
      } else {
        console.log("Purchased using stablecoin.");
        await buyFractions(tokenId, amountToBuy);
        console.log("buyFractions called with tokenId:", tokenId, "amount:", amountToBuy.toString());
      }

      toast.dismiss();
      toast.success("Purchase successful!");
      setAmount(''); 
    } catch (err) {
      toast.dismiss();
      toast.error("Purchase failed.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mt-4 p-3 bg-gray-50 rounded-md border">
      {/* Payment Method Toggle */}
      <div className="flex gap-4 mb-3 text-sm">
        <label className="flex items-center cursor-pointer">
          <input 
            type="radio" 
            name="paymentMethod" 
            checked={!useNativeToken} 
            onChange={() => setUseNativeToken(false)}
            className="mr-2"
          />
          Pay with Stablecoin
        </label>
        <label className="flex items-center cursor-pointer">
          <input 
            type="radio" 
            name="paymentMethod" 
            checked={useNativeToken} 
            onChange={() => setUseNativeToken(true)}
            className="mr-2"
          />
          Pay with Native Token (MATIC)
        </label>
      </div>

      <div className="flex gap-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          // FIX: Use the helper function here instead of calling formatUnits directly
          placeholder={`Amount (max ${formatMaxAmount()})`}
          className="flex-1 p-2 border rounded-md"
          disabled={isLoading}
        />
        
        {useNativeToken ? (
             <button
             onClick={handleBuy}
             disabled={isLoading || !amount}
             className="px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400"
           >
             {isLoading ? 'Buying...' : 'Buy with Native'}
           </button>
        ) : (
          isApproved ? (
            <button
              onClick={handleBuy}
              disabled={isLoading || !amount}
              className="px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400"
            >
              {isLoading ? 'Buying...' : 'Buy'}
            </button>
          ) : (
            <button
              onClick={handleApprove}
              disabled={isLoading || isCheckingAllowance || !amount}
              className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {isLoading ? 'Approving...' : (isCheckingAllowance ? 'Checking...' : 'Approve')}
            </button>
          )
        )}
      </div>
      
      {!isApproved && !isCheckingAllowance && !useNativeToken && (
        <p className="text-xs text-gray-500 mt-1">
          You must approve the contract to spend your stablecoin first.
        </p>
      )}
       {useNativeToken && (
        <p className="text-xs text-gray-500 mt-1">
          Native payments require no approval. Ensure you have sufficient gas and funds.
        </p>
      )}
    </div>
  );
};