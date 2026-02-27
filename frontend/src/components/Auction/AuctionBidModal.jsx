import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { toast } from 'sonner';
import { placeBid, getAuctionBids } from '../../utils/api';

const AuctionBidModal = ({ isOpen, onClose, auction, onBidSuccess }) => {
  const [yieldBps, setYieldBps] = useState('');
  const [bidAmount, setBidAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [bids, setBids] = useState([]);
  const [isLoadingBids, setIsLoadingBids] = useState(false);

  useEffect(() => {
    if (auction && isOpen) {
      loadBids();
      // Set default bid amount to face value
      if (auction.face_value) {
        setBidAmount(ethers.formatUnits(auction.face_value, 18));
      }
      // Set default yield to min yield
      if (auction.min_yield_bps) {
        setYieldBps((auction.min_yield_bps / 100).toFixed(2));
      }
    }
  }, [auction, isOpen]);

  const loadBids = async () => {
    if (!auction?.auction_id) return;
    
    try {
      setIsLoadingBids(true);
      const response = await getAuctionBids(auction.auction_id);
      setBids(response.data.bids || []);
    } catch (error) {
      console.error('Error loading bids:', error);
    } finally {
      setIsLoadingBids(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!auction) return;

    const yieldBpsValue = parseFloat(yieldBps) * 100; // Convert percentage to bps
    const bidAmountValue = ethers.parseUnits(bidAmount, 18).toString();

    // Validation
    if (yieldBpsValue > parseInt(auction.min_yield_bps)) {
      toast.error(`Yield must be ${(auction.min_yield_bps / 100).toFixed(2)}% or lower`);
      return;
    }

    if (parseFloat(bidAmount) <= 0) {
      toast.error('Bid amount must be greater than 0');
      return;
    }

    try {
      setIsLoading(true);
      await placeBid(auction.auction_id, {
        yieldBps: Math.floor(yieldBpsValue),
        bidAmount: bidAmountValue
      });
      
      toast.success('Bid placed successfully!');
      onBidSuccess?.();
      onClose();
    } catch (error) {
      console.error('Error placing bid:', error);
      toast.error(error.response?.data?.error || 'Failed to place bid');
    } finally {
      setIsLoading(false);
    }
  };

  const formatAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatAmount = (amount) => {
    try {
      return ethers.formatUnits(amount || '0', 18);
    } catch {
      return '0';
    }
  };

  const formatYield = (yieldBps) => {
    if (!yieldBps) return 'N/A';
    return `${(yieldBps / 100).toFixed(2)}%`;
  };

  if (!isOpen || !auction) return null;

  const minYield = (auction.min_yield_bps / 100).toFixed(2);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div 
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" 
          onClick={onClose}
        />

        {/* Modal panel */}
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          {/* Header */}
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Place Bid on Auction
                </h3>
                
                {/* Auction Info */}
                <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                  <div className="text-sm text-gray-600">
                    <p><span className="font-medium">Invoice:</span> {auction.invoice_id?.slice(0, 10)}...</p>
                    <p><span className="font-medium">Face Value:</span> ${formatAmount(auction.face_value)}</p>
                    <p><span className="font-medium">Min Yield Required:</span> {minYield}% or lower</p>
                  </div>
                </div>

                {/* Bid Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Yield Offer (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={minYield}
                      value={yieldBps}
                      onChange={(e) => setYieldBps(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={`Max ${minYield}%`}
                      required
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Lower yield = better for seller. Max: {minYield}%
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Bid Amount
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Enter bid amount"
                      required
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Face value: ${formatAmount(auction.face_value)}
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Placing Bid...' : 'Place Bid'}
                  </button>
                </form>

                {/* Current Bids */}
                {bids.length > 0 && (
                  <div className="mt-6">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Current Bids</h4>
                    <div className="max-h-40 overflow-y-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Bidder</th>
                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Yield</th>
                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {bids.slice(0, 5).map((bid) => (
                            <tr key={bid.bid_id}>
                              <td className="px-2 py-1 text-xs text-gray-500">
                                {formatAddress(bid.bidder_address)}
                              </td>
                              <td className="px-2 py-1 text-xs text-green-600">
                                {formatYield(bid.yield_bps)}
                              </td>
                              <td className="px-2 py-1 text-xs text-gray-900">
                                ${formatAmount(bid.bid_amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              onClick={onClose}
              className="w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuctionBidModal;
