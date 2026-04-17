import { useState } from 'react';
import { purchaseFNTokens } from '../../utils/tokenSale';
import { toast } from 'react-hot-toast';

export const BuyFNToken = ({ saleContractAddress }) => {
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleBuy = async () => {
    // Validate the input amount
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setIsLoading(true);
    toast.loading("Processing FN token purchase...");

    try {
      // Call the utility function to trigger the smart contract transaction
      await purchaseFNTokens(amount, saleContractAddress);
      
      toast.dismiss();
      toast.success("FN Tokens purchased successfully!");
      setAmount(''); // Reset the input field on success
      
    } catch (err) {
      toast.dismiss();
      console.error("Token purchase error:", err);
      // Display the revert reason if available, otherwise a generic fallback
      toast.error(err.reason || err.message || "Purchase failed.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mt-4 p-4 bg-gray-50 rounded-md border shadow-sm">
      <h3 className="text-lg font-semibold mb-2">Participate in FN Token Sale</h3>
      <p className="text-sm text-gray-600 mb-4">
        Enter the amount of Native Token (ETH/MATIC) you wish to spend to acquire FN tokens.
      </p>

      <div className="flex gap-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (e.g., 0.1)"
          className="flex-1 p-2 border rounded-md"
          disabled={isLoading}
          min="0"
          step="0.01"
        />
        
        <button
          onClick={handleBuy}
          disabled={isLoading || !amount}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition-colors whitespace-nowrap"
        >
          {isLoading ? 'Buying...' : 'Buy FN Tokens'}
        </button>
      </div>
    </div>
  );
};