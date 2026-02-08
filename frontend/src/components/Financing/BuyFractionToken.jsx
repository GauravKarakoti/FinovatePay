import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import {
  approveStablecoin,
  checkStablecoinAllowance,
  buyFractionsNative
} from '../../utils/web3';

import { gaslessDeposit } from '../../utils/gasless';
import { toast } from 'sonner';

const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS;

export const BuyFractionToken = ({
  tokenId,
  stablecoinAddress,
  stablecoinDecimals,
  tokenDecimals,
  maxAmount,
  onSuccess
}) => {

  const [amount, setAmount] = useState('');
  const [allowance, setAllowance] = useState(0n);
  const [isApproved, setIsApproved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAllowance, setIsCheckingAllowance] = useState(true);
  const [useNativeToken, setUseNativeToken] = useState(false);

  /* ================= HELPERS ================= */

  const formatMaxAmount = () => {
    try {
      if (typeof maxAmount === 'string' && maxAmount.includes('.')) {
        return maxAmount;
      }
      // Otherwise, assume it's base units and format it
      return ethers.formatUnits(maxAmount, tokenDecimals);
    } catch (error) {
      // Fallback to displaying as-is if formatting fails
      console.error("Error formatting maxAmount:", error);
      return maxAmount;
    }
  };

  const amountInBaseUnits = () => {
    try {
      return ethers.parseUnits(amount || '0', tokenDecimals);
    } catch (error) {
      console.error("Error parsing amount:", amount, "with decimals:", tokenDecimals, error);
      return 0n;
    }
  };

  const amountToApprove = () => {
    try {
      return ethers.parseUnits(amount || '0', stablecoinDecimals);
    } catch (error) {
      console.error("Error parsing amount for approval:", amount, "with decimals:", stablecoinDecimals, error);
      return 0n;
    }
  };

  /* ================= ALLOWANCE ================= */

  useEffect(() => {
    if (useNativeToken) {
      setIsApproved(true);
      setIsCheckingAllowance(false);
      return;
    }

    const checkAllowance = async () => {
      try {
        setIsCheckingAllowance(true);
        const currentAllowance = await checkStablecoinAllowance(stablecoinAddress);
        setAllowance(currentAllowance ?? 0n);
        console.log("Current allowance:", ethers.formatUnits(currentAllowance ?? 0n, stablecoinDecimals));
      } catch (err) {
        console.error("Error checking allowance:", err);
        setAllowance(0n);
      } finally {
        setIsCheckingAllowance(false);
      }
    };

    checkAllowance();
  }, [stablecoinAddress, useNativeToken, stablecoinDecimals]);

  useEffect(() => {
    if (useNativeToken) return;

    if (!amount) {
      setIsApproved(false);
      return;
    }

    const needed = amountToApprove();
    setIsApproved(allowance >= needed);
    console.log("Is approved check:", allowance.toString(), "needed:", needed.toString());
  }, [amount, allowance, stablecoinDecimals, useNativeToken]);

  /* ================= APPROVE ================= */

  const handleApprove = async () => {
    setIsLoading(true);
    const toastId = toast.loading("Approving stablecoin...");

    try {
      const needed = amountToApprove();
      await approveStablecoin(stablecoinAddress, needed);

      setAllowance(needed);
      setIsApproved(true);

      toast.dismiss(toastId);
      toast.success("Approved successfully!");
    } catch (error) {
      toast.dismiss(toastId);
      toast.error("Approval failed: " + (error.message || "Unknown error"));
      console.error("Approval error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  /* ================= BUY (GASLESS) ================= */

  const handleBuy = async () => {
    setIsLoading(true);
    const toastId = toast.loading("Processing purchase...");

    try {
      const amountToBuy = amountInBaseUnits();

      /* ---------- NATIVE FLOW ---------- */
      if (useNativeToken) {
        await buyFractionsNative(tokenId, amountToBuy);
      }

      /* ---------- STABLECOIN FLOW (GASLESS) ---------- */
      else {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();

        const result = await gaslessDeposit(
          signer,
          ESCROW_ADDRESS,
          tokenId,
          amountToBuy
        );

        if (!result.success) {
          throw new Error(result.error || "Gasless transaction failed");
        }

        console.log("Gasless tx hash:", result.hash);
        toast.success(`Transaction submitted! Hash: ${result.hash.slice(0, 10)}...`);
      }

      toast.dismiss(toastId);
      toast.success("Purchase successful!");
      setAmount('');
      onSuccess?.();

    } catch (err) {
      toast.dismiss(toastId);
      toast.error(err.message || "Purchase failed");
      console.error("Purchase error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  /* ================= UI ================= */

  return (
    <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-sm">

      {/* Toggle */}
      <div className="flex gap-4 mb-4 text-sm font-medium">
        <label className="flex items-center gap-2 cursor-pointer hover:text-blue-600 transition-colors">
          <input
            type="radio"
            checked={!useNativeToken}
            onChange={() => setUseNativeToken(false)}
            className="w-4 h-4 text-blue-600"
          />
          <span>Stablecoin (Gasless)</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer hover:text-blue-600 transition-colors">
          <input
            type="radio"
            checked={useNativeToken}
            onChange={() => setUseNativeToken(true)}
            className="w-4 h-4 text-blue-600"
          />
          <span>Native Token</span>
        </label>
      </div>

      <div className="flex gap-3">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Amount (max ${formatMaxAmount()})`}
          disabled={isLoading || isCheckingAllowance}
          className="flex-1 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
        />

        {useNativeToken ? (
          <button 
            onClick={handleBuy} 
            disabled={isLoading || !amount}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors min-w-[120px]"
          >
            {isLoading ? 'Buying...' : 'Buy Native'}
          </button>
        ) : isApproved ? (
          <button 
            onClick={handleBuy} 
            disabled={isLoading || !amount}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors min-w-[120px]"
          >
            {isLoading ? 'Buying...' : 'Buy (Gasless)'}
          </button>
        ) : (
          <button 
            onClick={handleApprove} 
            disabled={isLoading || !amount || isCheckingAllowance}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors min-w-[120px]"
          >
            {isCheckingAllowance ? 'Checking...' : isLoading ? 'Approving...' : 'Approve'}
          </button>
        )}
      </div>

      {/* Info text */}
      <p className="mt-3 text-xs text-gray-500">
        {useNativeToken 
          ? "Pay with native blockchain tokens (requires gas)" 
          : "Pay with stablecoins gaslessly via relayer"}
      </p>
    </div>
  );
};