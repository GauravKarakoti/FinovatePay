import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { toast } from 'react-hot-toast';

import FinancingManagerArtifact from '../../../../deployed/FinancingManager.json';
import ERC20Artifact from '../../../../deployed/ERC20.json';
import contractAddresses from '../../../../deployed/contract-addresses.json';

const FINANCING_MANAGER_ADDRESS = contractAddresses.FinancingManager;

export const BuyFractionToken = ({
  tokenId,
  stablecoinAddress,
  stablecoinDecimals,
  tokenDecimals,
  maxAmount
}) => {
  const { address } = useAccount();
  const { writeContract, isPending: isWriting, data: hash, error: writeError } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess: isConfirmed, error: confirmError } = useWaitForTransactionReceipt({
    hash,
  });

  const [amount, setAmount] = useState('');
  const [useNativeToken, setUseNativeToken] = useState(false);

  // Read allowance
  const { data: allowance, refetch: refetchAllowance, isLoading: isCheckingAllowance } = useReadContract({
    address: stablecoinAddress,
    abi: ERC20Artifact.abi,
    functionName: 'allowance',
    args: [address, FINANCING_MANAGER_ADDRESS],
    query: {
      enabled: !!address && !useNativeToken,
    }
  });

  // Calculate needed amount
  // We handle parsing carefully. If amount is empty, 0.
  const getAmountToApprove = () => {
    try {
      if (!amount) return 0n;
      return parseUnits(amount, stablecoinDecimals);
    } catch (e) {
      return 0n;
    }
  };

  const amountToApprove = getAmountToApprove();
  const currentAllowance = allowance ? BigInt(allowance) : 0n;
  const isApproved = !useNativeToken ? (currentAllowance >= amountToApprove) : true;

  // Helper to safely format the max amount for display
  const formatMaxAmount = () => {
    if (!maxAmount) return '0';
    try {
      // If it's already a decimal string (e.g. "0.48"), return it as is
      if (typeof maxAmount === 'string' && maxAmount.includes('.')) {
        return maxAmount;
      }
      // If it's bigint or string integer
      return formatUnits(BigInt(maxAmount.toString()), tokenDecimals);
    } catch (error) {
      // Fallback
      return maxAmount.toString();
    }
  };

  const handleApprove = () => {
     if (!amount) return;
     toast.loading("Waiting for approval...");
     writeContract({
       address: stablecoinAddress,
       abi: ERC20Artifact.abi,
       functionName: 'approve',
       args: [FINANCING_MANAGER_ADDRESS, amountToApprove],
     });
  };

  const handleBuy = () => {
    if (!amount) return;
    try {
        const amountToBuy = parseUnits(amount, tokenDecimals);
        toast.loading("Processing purchase...");

        if (useNativeToken) {
        writeContract({
            address: FINANCING_MANAGER_ADDRESS,
            abi: FinancingManagerArtifact.abi,
            functionName: 'buyFractionsNative',
            args: [tokenId, amountToBuy],
            value: amountToBuy
        });
        } else {
        writeContract({
            address: FINANCING_MANAGER_ADDRESS,
            abi: FinancingManagerArtifact.abi,
            functionName: 'buyFractions',
            args: [tokenId, amountToBuy],
        });
        }
    } catch (err) {
        console.error("Error parsing amount:", err);
        toast.error("Invalid amount");
    }
  };

  // Handle confirmation toasts and refetches
  useEffect(() => {
    if (isConfirmed) {
       toast.dismiss();
       toast.success("Transaction confirmed!");
       refetchAllowance();
       setAmount('');
    }
    if (confirmError || writeError) {
        toast.dismiss();
        toast.error("Transaction failed or rejected.");
        console.error(confirmError || writeError);
    }
  }, [isConfirmed, confirmError, writeError, refetchAllowance]);

  // Handle loading state for toast dismissal if needed or generic loading
  const isLoading = isWriting || isConfirming;

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
