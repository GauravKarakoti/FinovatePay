import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import {
  approveStablecoin,
  checkStablecoinAllowance,
  buyFractionsNative
} from '../../utils/web3';

import { gaslessDeposit } from '../../utils/gasless';
import { toast } from 'react-hot-toast';

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
      return maxAmount;
    }
  };

  const amountInBaseUnits = () => {
    try {
      return ethers.parseUnits(amount || '0', tokenDecimals);
    } catch {
      console.log("Error parsing amount:", amount, "with decimals:", tokenDecimals);
      return 0n;
    }
  };

  const amountToApprove = () => {
    try {
      return ethers.parseUnits(amount || '0', stablecoinDecimals);
    } catch {
      console.log("Error parsing amount for approval:", amount, "with decimals:", stablecoinDecimals);
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
        console.error(err);
      } finally {
        setIsCheckingAllowance(false);
      }
    };

    checkAllowance();
  }, [stablecoinAddress, useNativeToken]);

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

  const handleApprove = async () => {
    setIsLoading(true);
    toast.loading("Approving stablecoin...");

    try {
      const needed = amountToApprove();
      await approveStablecoin(stablecoinAddress, needed);

      setAllowance(needed);
      setIsApproved(true);

      toast.dismiss();
      toast.success("Approved!");
    } catch {
      toast.dismiss();
      toast.error("Approval failed");
    }

    setIsLoading(false);
  };

  /* ================= BUY (UPDATED GASLESS) ================= */

  const handleBuy = async () => {
    setIsLoading(true);
    toast.loading("Processing purchase...");

    try {
      const amountToBuy = amountInBaseUnits();

      /* ---------- NATIVE FLOW (unchanged) ---------- */
      if (useNativeToken) {
        await buyFractionsNative(tokenId, amountToBuy);
      }

      /* ---------- STABLECOIN FLOW (NOW GASLESS) ---------- */
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
          throw new Error(result.error || "Gasless failed");
        }

        console.log("Gasless tx:", result.hash);
      }

      toast.dismiss();
      toast.success("Purchase successful!");
      setAmount('');
      onSuccess?.();

    } catch (err) {
      toast.dismiss();
      toast.error(err.message || "Purchase failed");
      console.error(err);
    }

    setIsLoading(false);
  };

  /* ================= UI ================= */

  return (
    <div className="mt-4 p-3 bg-gray-50 rounded-md border">

      {/* Toggle */}
      <div className="flex gap-4 mb-3 text-sm">
        <label>
          <input
            type="radio"
            checked={!useNativeToken}
            onChange={() => setUseNativeToken(false)}
          /> Stablecoin
        </label>

        <label>
          <input
            type="radio"
            checked={useNativeToken}
            onChange={() => setUseNativeToken(true)}
          /> Native
        </label>
      </div>

      <div className="flex gap-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Amount (max ${formatMaxAmount()})`}
          className="flex-1 p-2 border rounded"
        />

        {useNativeToken ? (
          <button onClick={handleBuy} className="bg-green-600 text-white px-3 py-2 rounded">
            Buy Native
          </button>
        ) : (
          isApproved ? (
            <button onClick={handleBuy} className="bg-green-600 text-white px-3 py-2 rounded">
              Buy (Gasless)
            </button>
          ) : (
            <button onClick={handleApprove} className="bg-blue-600 text-white px-3 py-2 rounded">
              Approve
            </button>
          )
        )}
      </div>
    </div>
  );
};
