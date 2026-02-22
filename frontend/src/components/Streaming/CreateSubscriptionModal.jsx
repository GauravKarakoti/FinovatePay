import { useState } from 'react';
import { ethers } from 'ethers';
import { toast } from 'sonner';
import { createStream } from '../../utils/api';
import { connectWallet } from '../../utils/web3';
import { NATIVE_CURRENCY_ADDRESS } from '../../utils/constants';

const CreateSubscriptionModal = ({ isOpen, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    buyerAddress: '',
    totalAmount: '',
    interval: 'monthly',
    numPayments: '12',
    description: '',
    tokenAddress: NATIVE_CURRENCY_ADDRESS
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Validate input
      if (!formData.buyerAddress) {
        throw new Error('Buyer address is required');
      }
      if (!formData.totalAmount || parseFloat(formData.totalAmount) <= 0) {
        throw new Error('Valid amount is required');
      }
      if (!formData.numPayments || parseInt(formData.numPayments) <= 0) {
        throw new Error('Number of payments is required');
      }

      const { address: sellerAddress } = await connectWallet();

      const streamData = {
        buyerAddress: formData.buyerAddress,
        totalAmount: parseFloat(formData.totalAmount),
        interval: formData.interval,
        numPayments: parseInt(formData.numPayments),
        tokenAddress: formData.tokenAddress,
        description: formData.description || `Subscription payment - ${formData.interval} payments`
      };

      const response = await createStream(streamData);

      toast.success('Subscription created successfully!', {
        description: 'Waiting for buyer approval'
      });

      onSuccess?.(response.data);
      onClose();
      
      // Reset form
      setFormData({
        buyerAddress: '',
        totalAmount: '',
        interval: 'monthly',
        numPayments: '12',
        description: '',
        tokenAddress: NATIVE_CURRENCY_ADDRESS
      });

    } catch (error) {
      console.error('Error creating subscription:', error);
      toast.error(error.response?.data?.error || error.message || 'Failed to create subscription');
    } finally {
      setIsSubmitting(false);
    }
  };

  const intervalOptions = [
    { value: 'daily', label: 'Daily', multiplier: 1 },
    { value: 'weekly', label: 'Weekly', multiplier: 7 },
    { value: 'monthly', label: 'Monthly', multiplier: 30 }
  ];

  const calculatePerPayment = () => {
    if (!formData.totalAmount || !formData.numPayments) return '0';
    const total = parseFloat(formData.totalAmount);
    const payments = parseInt(formData.numPayments);
    if (isNaN(total) || isNaN(payments) || payments === 0) return '0';
    return (total / payments).toFixed(2);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-fadeIn">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">Create Subscription Invoice</h3>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Buyer Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Buyer Address (Client)
            </label>
            <input
              type="text"
              name="buyerAddress"
              value={formData.buyerAddress}
              onChange={handleChange}
              placeholder="0x..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Total Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Total Subscription Amount (USDC)
            </label>
            <input
              type="number"
              name="totalAmount"
              value={formData.totalAmount}
              onChange={handleChange}
              placeholder="1000"
              min="0"
              step="0.01"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Interval */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Interval
            </label>
            <select
              name="interval"
              value={formData.interval}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {intervalOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Number of Payments */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Number of Payments
            </label>
            <input
              type="number"
              name="numPayments"
              value={formData.numPayments}
              onChange={handleChange}
              placeholder="12"
              min="1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (Optional)
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Monthly retainer for consulting services..."
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Summary */}
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="text-sm text-blue-800">
              <span className="font-medium">Per Payment:</span> ${calculatePerPayment()} USDC
            </div>
            <div className="text-xs text-blue-600 mt-1">
              Total contract: {formData.totalAmount || '0'} USDC over {formData.numPayments || '0'} {formData.interval} payments
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Subscription'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateSubscriptionModal;
