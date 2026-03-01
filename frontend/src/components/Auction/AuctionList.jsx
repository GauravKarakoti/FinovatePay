import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { toast } from 'sonner';
import { 
  getAuctions, 
  getSellerAuctions, 
  getAuctionBids,
  startAuction,
  endAuction,
  settleAuction,
  cancelAuction
} from '../../utils/api';
import AuctionBidModal from './AuctionBidModal';

const AuctionList = ({ userRole = 'seller', onAuctionUpdate }) => {
  const [auctions, setAuctions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAuction, setSelectedAuction] = useState(null);
  const [showBidModal, setShowBidModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [view, setView] = useState('all'); // 'all', 'mine', 'bids'

  useEffect(() => {
    loadAuctions();
  }, [userRole, view]);

  const loadAuctions = async () => {
    try {
      setIsLoading(true);
      let response;
      
      if (view === 'mine') {
        response = await getSellerAuctions();
      } else if (view === 'bids') {
        response = await getSellerAuctions(); // This needs to be bidder auctions
      } else {
        response = await getAuctions({ status: 'active' });
      }
      
      setAuctions(response.data.auctions || []);
    } catch (error) {
      console.error('Error loading auctions:', error);
      toast.error('Failed to load auctions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStart = async (auctionId) => {
    try {
      setActionLoading(auctionId);
      await startAuction(auctionId);
      toast.success('Auction started!');
      loadAuctions();
      onAuctionUpdate?.();
    } catch (error) {
      console.error('Error starting auction:', error);
      toast.error(error.response?.data?.error || 'Failed to start auction');
    } finally {
      setActionLoading(null);
    }
  };

  const handleEnd = async (auctionId) => {
    try {
      setActionLoading(auctionId);
      await endAuction(auctionId);
      toast.success('Auction ended!');
      loadAuctions();
      onAuctionUpdate?.();
    } catch (error) {
      console.error('Error ending auction:', error);
      toast.error(error.response?.data?.error || 'Failed to end auction');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSettle = async (auctionId) => {
    try {
      setActionLoading(auctionId);
      await settleAuction(auctionId);
      toast.success('Auction settled!');
      loadAuctions();
      onAuctionUpdate?.();
    } catch (error) {
      console.error('Error settling auction:', error);
      toast.error(error.response?.data?.error || 'Failed to settle auction');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (auctionId) => {
    if (!confirm('Are you sure you want to cancel this auction?')) {
      return;
    }
    try {
      setActionLoading(auctionId);
      await cancelAuction(auctionId);
      toast.success('Auction cancelled');
      loadAuctions();
      onAuctionUpdate?.();
    } catch (error) {
      console.error('Error cancelling auction:', error);
      toast.error(error.response?.data?.error || 'Failed to cancel auction');
    } finally {
      setActionLoading(null);
    }
  };

  const handleBid = (auction) => {
    setSelectedAuction(auction);
    setShowBidModal(true);
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

  const getTimeRemaining = (endTime) => {
    if (!endTime) return 'N/A';
    const end = new Date(endTime);
    const now = new Date();
    const diff = end - now;
    
    if (diff <= 0) return 'Ended';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      created: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Created' },
      active: { bg: 'bg-green-100', text: 'text-green-800', label: 'Active' },
      ended: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Ended' },
      cancelled: { bg: 'bg-red-100', text: 'text-red-800', label: 'Cancelled' },
      settled: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Settled' }
    };
    const config = statusConfig[status] || statusConfig.created;
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  const canStart = (auction) => {
    return userRole === 'seller' && auction.status === 'created';
  };

  const canBid = (auction) => {
    return userRole === 'investor' && auction.status === 'active';
  };

  const canEnd = (auction) => {
    return auction.status === 'active' && new Date(auction.auction_end_time) <= new Date();
  };

  const canSettle = (auction) => {
    return auction.status === 'ended' && auction.highest_bidder;
  };

  const canCancel = (auction) => {
    return userRole === 'seller' && ['created', 'active'].includes(auction.status);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (auctions.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-lg">
        <div className="text-4xl mb-2">🏷️</div>
        <p className="text-gray-500">No auctions found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {auctions.map((auction) => (
        <div 
          key={auction.auction_id} 
          className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            {/* Auction Info */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                {getStatusBadge(auction.status)}
                <span className="text-sm text-gray-500">
                  Invoice: {auction.invoice_id?.slice(0, 8)}...
                </span>
              </div>
              
              <div className="text-sm text-gray-600 mb-1">
                <span className="font-medium">Face Value:</span> ${formatAmount(auction.face_value)}
              </div>
              
              <div className="text-sm text-gray-600 mb-1">
                <span className="font-medium">Min Yield:</span> {formatYield(auction.min_yield_bps)}
              </div>
              
              {auction.highest_bid && parseFloat(auction.highest_bid) > 0 && (
                <div className="text-sm text-gray-600 mb-1">
                  <span className="font-medium">Highest Bid:</span> ${formatAmount(auction.highest_bid)}
                  {auction.highest_bidder && (
                    <span className="text-gray-400 ml-1">
                      by {formatAddress(auction.highest_bidder)}
                    </span>
                  )}
                </div>
              )}
              
              <div className="text-xs text-gray-400">
                <span>Seller: {formatAddress(auction.seller_address)}</span>
                <span className="ml-3">
                  Time: {getTimeRemaining(auction.auction_end_time)}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {canStart(auction) && (
                <button
                  onClick={() => handleStart(auction.auction_id)}
                  disabled={actionLoading === auction.auction_id}
                  className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading === auction.auction_id ? 'Starting...' : 'Start Auction'}
                </button>
              )}
              
              {canBid(auction) && (
                <button
                  onClick={() => handleBid(auction)}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Place Bid
                </button>
              )}
              
              {canEnd(auction) && (
                <button
                  onClick={() => handleEnd(auction.auction_id)}
                  disabled={actionLoading === auction.auction_id}
                  className="px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                >
                  {actionLoading === auction.auction_id ? 'Ending...' : 'End Auction'}
                </button>
              )}
              
              {canSettle(auction) && (
                <button
                  onClick={() => handleSettle(auction.auction_id)}
                  disabled={actionLoading === auction.auction_id}
                  className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  {actionLoading === auction.auction_id ? 'Settling...' : 'Settle'}
                </button>
              )}
              
              {canCancel(auction) && (
                <button
                  onClick={() => handleCancel(auction.auction_id)}
                  disabled={actionLoading === auction.auction_id}
                  className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
                >
                  {actionLoading === auction.auction_id ? 'Cancelling...' : 'Cancel'}
                </button>
              )}
            </div>
          </div>
          
          {/* Winner Info */}
          {auction.status === 'settled' && auction.winner_address && (
            <div className="mt-3 pt-3 border-t border-gray-100 text-sm">
              <span className="font-medium text-green-600">
                ✓ Won by {formatAddress(auction.winner_address)} 
                (Yield: {formatYield(auction.winning_yield_bps)})
              </span>
            </div>
          )}
        </div>
      ))}

      {/* Bid Modal */}
      <AuctionBidModal
        isOpen={showBidModal}
        onClose={() => {
          setShowBidModal(false);
          setSelectedAuction(null);
        }}
        auction={selectedAuction}
        onBidSuccess={() => {
          loadAuctions();
          onAuctionUpdate?.();
        }}
      />
    </div>
  );
};

export default AuctionList;
