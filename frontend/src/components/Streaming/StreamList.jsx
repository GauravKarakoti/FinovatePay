import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { toast } from 'sonner';
import { 
  getMyStreams, 
  approveStream, 
  pauseStream, 
  resumeStream, 
  cancelStream,
  releasePayment 
} from '../../utils/api';
import { connectWallet } from '../../utils/web3';

const StreamList = ({ userRole = 'seller', onStreamUpdate }) => {
  const [streams, setStreams] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => {
    loadStreams();
  }, [userRole]);

  const loadStreams = async () => {
    try {
      setIsLoading(true);
      const response = await getMyStreams();
      setStreams(response.data || []);
    } catch (error) {
      console.error('Error loading streams:', error);
      toast.error('Failed to load streams');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (streamId, amount) => {
    try {
      setActionLoading(streamId);
      await approveStream(streamId, amount);
      toast.success('Stream approved and funded!');
      loadStreams();
      onStreamUpdate?.();
    } catch (error) {
      console.error('Error approving stream:', error);
      toast.error(error.response?.data?.error || 'Failed to approve stream');
    } finally {
      setActionLoading(null);
    }
  };

  const handlePause = async (streamId) => {
    try {
      setActionLoading(streamId);
      await pauseStream(streamId);
      toast.success('Stream paused');
      loadStreams();
      onStreamUpdate?.();
    } catch (error) {
      console.error('Error pausing stream:', error);
      toast.error(error.response?.data?.error || 'Failed to pause stream');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResume = async (streamId) => {
    try {
      setActionLoading(streamId);
      await resumeStream(streamId);
      toast.success('Stream resumed');
      loadStreams();
      onStreamUpdate?.();
    } catch (error) {
      console.error('Error resuming stream:', error);
      toast.error(error.response?.data?.error || 'Failed to resume stream');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (streamId) => {
    if (!confirm('Are you sure you want to cancel this stream? This action cannot be undone.')) {
      return;
    }
    try {
      setActionLoading(streamId);
      await cancelStream(streamId);
      toast.success('Stream cancelled');
      loadStreams();
      onStreamUpdate?.();
    } catch (error) {
      console.error('Error cancelling stream:', error);
      toast.error(error.response?.data?.error || 'Failed to cancel stream');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRelease = async (streamId) => {
    try {
      setActionLoading(streamId);
      await releasePayment(streamId);
      toast.success('Payment released!');
      loadStreams();
      onStreamUpdate?.();
    } catch (error) {
      console.error('Error releasing payment:', error);
      toast.error(error.response?.data?.error || 'Failed to release payment');
    } finally {
      setActionLoading(null);
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

  const getStatusBadge = (status) => {
    const statusConfig = {
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
      active: { bg: 'bg-green-100', text: 'text-green-800', label: 'Active' },
      paused: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Paused' },
      cancelled: { bg: 'bg-red-100', text: 'text-red-800', label: 'Cancelled' },
      completed: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Completed' }
    };
    const config = statusConfig[status] || statusConfig.pending;
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  const canApprove = (stream) => {
    return userRole === 'buyer' && stream.status === 'pending';
  };

  const canPause = (stream) => {
    return userRole === 'buyer' && stream.status === 'active';
  };

  const canResume = (stream) => {
    return userRole === 'buyer' && stream.status === 'paused';
  };

  const canCancel = (stream) => {
    return ['pending', 'active', 'paused'].includes(stream.status);
  };

  const canRelease = (stream) => {
    return stream.status === 'active' && stream.next_release_time && new Date(stream.next_release_time) <= new Date();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (streams.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-lg">
        <div className="text-4xl mb-2">📊</div>
        <p className="text-gray-500">No subscription streams found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {streams.map((stream) => (
        <div 
          key={stream.stream_id} 
          className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            {/* Stream Info */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                {getStatusBadge(stream.status)}
                <span className="text-sm text-gray-500 capitalize">{stream.interval_type}</span>
              </div>
              
              <div className="text-sm text-gray-600 mb-1">
                <span className="font-medium">Amount:</span> ${formatAmount(stream.amount)} USDC
              </div>
              
              <div className="text-sm text-gray-600 mb-1">
                <span className="font-medium">Per Payment:</span> ${formatAmount(stream.per_interval_amount)}
              </div>
              
              <div className="text-sm text-gray-500 mb-2">
                <span className="font-medium">Progress:</span> {stream.intervals_completed || 0}/{stream.total_intervals} payments
                ({formatAmount(stream.total_released)} released)
              </div>
              
              <div className="text-xs text-gray-400">
                {userRole === 'seller' ? (
                  <span>Buyer: {formatAddress(stream.buyer_address)}</span>
                ) : (
                  <span>Seller: {formatAddress(stream.seller_address)}</span>
                )}
              </div>
              
              {stream.description && (
                <div className="text-sm text-gray-500 mt-2 italic">
                  "{stream.description}"
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {canApprove(stream) && (
                <button
                  onClick={() => handleApprove(stream.stream_id, stream.amount)}
                  disabled={actionLoading === stream.stream_id}
                  className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading === stream.stream_id ? 'Approving...' : 'Approve & Fund'}
                </button>
              )}
              
              {canPause(stream) && (
                <button
                  onClick={() => handlePause(stream.stream_id)}
                  disabled={actionLoading === stream.stream_id}
                  className="px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                >
                  {actionLoading === stream.stream_id ? 'Pausing...' : 'Pause'}
                </button>
              )}
              
              {canResume(stream) && (
                <button
                  onClick={() => handleResume(stream.stream_id)}
                  disabled={actionLoading === stream.stream_id}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {actionLoading === stream.stream_id ? 'Resuming...' : 'Resume'}
                </button>
              )}
              
              {canRelease(stream) && (
                <button
                  onClick={() => handleRelease(stream.stream_id)}
                  disabled={actionLoading === stream.stream_id}
                  className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  {actionLoading === stream.stream_id ? 'Releasing...' : 'Release Payment'}
                </button>
              )}
              
              {canCancel(stream) && (
                <button
                  onClick={() => handleCancel(stream.stream_id)}
                  disabled={actionLoading === stream.stream_id}
                  className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
                >
                  {actionLoading === stream.stream_id ? 'Cancelling...' : 'Cancel'}
                </button>
              )}
            </div>
          </div>
          
          {/* Next Release Info */}
          {stream.status === 'active' && stream.next_release_time && (
            <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
              Next payment: {new Date(stream.next_release_time).toLocaleString()}
              {new Date(stream.next_release_time) <= new Date() && (
                <span className="ml-2 text-purple-600 font-medium">(Due now!)</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default StreamList;
