import { useState } from 'react';
import { toast } from 'sonner';
import { createAuction } from '../../utils/api'; // Ensure this exists in your API utils

const AuctionCreateModal = ({ isOpen, onClose, eligibleInvoices, onSuccess }) => {
  const [selectedInvoice, setSelectedInvoice] = useState('');
  const [minYield, setMinYield] = useState('');
  const [durationHours, setDurationHours] = useState('24');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedInvoice) return toast.error("Please select an invoice");

    setIsSubmitting(true);
    const toastId = toast.loading('Creating auction...');

    try {
      const endTime = new Date(Date.now() + Number(durationHours) * 60 * 60 * 1000).toISOString();
      
      // Assuming your API expects invoice_id, min_yield_bps, and auction_end_time
      await createAuction({
        invoice_id: selectedInvoice,
        min_yield_bps: Math.floor(parseFloat(minYield) * 100), // Convert % to BPS
        auction_end_time: endTime
      });

      toast.success('Auction created successfully!', { id: toastId });
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Failed to create auction:', error);
      toast.error(error.response?.data?.error || 'Failed to create auction', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Put Invoice up for Auction</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Select Invoice</label>
            <select 
              value={selectedInvoice}
              onChange={(e) => setSelectedInvoice(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md mt-1"
              required
            >
              <option value="">-- Choose an Invoice --</option>
              {eligibleInvoices.map(inv => (
                <option key={inv.invoice_id} value={inv.invoice_id}>
                  #{inv.invoice_id.substring(0, 8)} - {inv.description || 'Invoice'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Minimum Yield (%)</label>
            <input
              type="number"
              step="0.01"
              value={minYield}
              onChange={(e) => setMinYield(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md mt-1"
              placeholder="e.g., 5.00"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Duration (Hours)</label>
            <input
              type="number"
              value={durationHours}
              onChange={(e) => setDurationHours(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md mt-1"
              min="1"
              required
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50">
              {isSubmitting ? 'Creating...' : 'Create Auction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AuctionCreateModal;