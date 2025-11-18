import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import {
  approveStablecoin,
  checkStablecoinAllowance,
  buyFractions
} from '../../utils/web3';
import { toast } from 'react-hot-toast';

export const BuyFractionToken = ({
  tokenId,
  stablecoinAddress,
  stablecoinDecimals,
  tokenDecimals,
  maxAmount // Passed in base units
}) => {
  console.log("BuyFractionToken mounted with tokenId:", tokenId, "stablecoinAddress:", stablecoinAddress);
  const [amount, setAmount] = useState('');
  const [allowance, setAllowance] = useState(BigInt(0)); // BigInt is native JS, works fine
  const [isApproved, setIsApproved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAllowance, setIsCheckingAllowance] = useState(true);

  const amountInBaseUnits = () => {
    console.log("Converting amount:", amount, "with token decimals:", tokenDecimals);
    try {
      // FIX: Use ethers.utils.parseUnits for v5
      return ethers.utils.parseUnits(amount, tokenDecimals);
    } catch {
      console.log("Error converting amount to base units");
      return BigInt(0);
    }
  };

  const amountToApprove = () => {
    console.log("Calculating amount to approve for:", amount, "with stablecoin decimals:", stablecoinDecimals);
    try {
      // FIX: Use ethers.utils.parseUnits for v5
      return ethers.utils.parseUnits(amount, stablecoinDecimals);
    } catch {
      console.log("Error calculating amount to approve");
      return BigInt(0);
    }
  };

  useEffect(() => {
    console.log("Checking allowance for stablecoin:", stablecoinAddress);
    const checkAllowance = async () => {
      try {
        setIsCheckingAllowance(true);
        const currentAllowance = await checkStablecoinAllowance(stablecoinAddress);
        setAllowance(currentAllowance);
      } catch (err) {
        console.error("Failed to check allowance", err);
      } finally {
        setIsCheckingAllowance(false);
      }
    };
    checkAllowance();
  }, [stablecoinAddress]);

  useEffect(() => {
    console.log("Re-evaluating approval status. Current allowance:", allowance.toString(), "Needed for amount:", amountToApprove().toString());
    if (!amount || isNaN(Number(amount))) {
      setIsApproved(false);
      return;
    }
    const needed = amountToApprove();
    // Ethers v5 returns BigNumber, but native BigInt comparison often works if converted
    // Safer to use Ethers v5 .gte() method for BigNumbers
    setIsApproved(allowance.gte(needed));
    console.log("Is approved:", allowance.gte(needed));
  }, [amount, allowance, stablecoinDecimals]);

  const handleApprove = async () => {
    console.log("Starting approval for amount:", amountToApprove().toString());
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
      console.log("Approval failed", err);
      toast.dismiss();
      toast.error("Approval failed or rejected.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBuy = async () => {
    console.log("Initiating buy for tokenId:", tokenId, "amount:", amountInBaseUnits().toString());
    setIsLoading(true);
    toast.loading("Processing purchase...");
    try {
      const amountToBuy = amountInBaseUnits();
      await buyFractions(tokenId, amountToBuy);
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
      <div className="flex gap-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          // FIX: Use ethers.utils.formatUnits for v5
          placeholder={`Amount (max ${ethers.utils.formatUnits(maxAmount, tokenDecimals)})`}
          className="flex-1 p-2 border rounded-md"
          disabled={isLoading}
        />
        {isApproved ? (
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
        )}
      </div>
      {!isApproved && !isCheckingAllowance && (
        <p className="text-xs text-gray-500 mt-1">
          You must approve the contract to spend your stablecoin first.
        </p>
      )}
    </div>
  );
};