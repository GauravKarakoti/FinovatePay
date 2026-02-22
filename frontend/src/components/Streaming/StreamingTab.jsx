import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { connectWallet } from '../../utils/web3';
import CreateSubscriptionModal from './CreateSubscriptionModal';
import StreamList from './StreamList';

const StreamingTab = ({ userRole = 'seller' }) => {
  const [walletAddress, setWalletAddress] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeView, setActiveView] = useState('all'); // 'all', 'seller', 'buyer'

  useEffect(() => {
    const initWallet = async () => {
      try {
        const { address } = await connectWallet();
        setWalletAddress(address);
      } catch (error) {
        console.error('Failed to connect wallet:', error);
      }
    };
    initWallet();
  }, []);

  const handleStreamCreated = () => {
    // Refresh the stream list
    setShowCreateModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Streaming Payments</h2>
          <p className="text-sm text-gray-500">
            Manage recurring subscriptions and automated payments
          </p>
        </div>
        
        {userRole === 'seller' && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Create Subscription
          </button>
        )}
      </div>

      {/* View Toggle */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveView('all')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeView === 'all'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          All Streams
        </button>
        <button
          onClick={() => setActiveView('seller')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeView === 'seller'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          As Seller
        </button>
        <button
          onClick={() => setActiveView('buyer')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeView === 'buyer'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          As Buyer
        </button>
      </div>

      {/* Info Card */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="text-blue-600 text-xl">💸</div>
          <div>
            <h3 className="font-medium text-blue-900">How Streaming Payments Work</h3>
            <ul className="text-sm text-blue-700 mt-2 space-y-1">
              <li>• <strong>Seller:</strong> Create a subscription invoice with fixed payments</li>
              <li>• <strong>Buyer:</strong> Approve once and funds stream automatically over time</li>
              <li>• <strong>Cancel:</strong> Either party can stop the stream at any time</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stream List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">
            {activeView === 'all' && 'All Subscription Streams'}
            {activeView === 'seller' && 'Streams You Created (As Seller)'}
            {activeView === 'buyer' && 'Streams You\'re Paying (As Buyer)'}
          </h3>
        </div>
        <div className="p-4">
          <StreamList 
            userRole={userRole} 
            onStreamUpdate={() => {}}
          />
        </div>
      </div>

      {/* Create Modal */}
      <CreateSubscriptionModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleStreamCreated}
      />
    </div>
  );
};

export default StreamingTab;
