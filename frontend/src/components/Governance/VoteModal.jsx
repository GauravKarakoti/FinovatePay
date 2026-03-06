import React, { useState } from 'react';
import { castVote } from '../../utils/api';
import { toast } from 'sonner';

const VoteModal = ({ proposal, votingPower, onClose, onVoteSubmitted }) => {
  const [support, setSupport] = useState(true);
  const [loading, setLoading] = useState(false);
  const [useFullPower, setUseFullPower] = useState(true);

  const handleVote = async () => {
    try {
      setLoading(true);
      
      await castVote({
        proposalId: proposal.proposal_id,
        support,
        txHash: null // Would be set by wallet transaction in production
      });

      toast.success('Vote submitted successfully!');
      onVoteSubmitted?.();
    } catch (error) {
      console.error('Error casting vote:', error);
      toast.error(error.response?.data?.message || 'Failed to cast vote');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Cast Your Vote</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {/* Proposal Info */}
        <div className="bg-gray-50 p-4 rounded-lg mb-6">
          <h3 className="font-semibold text-gray-800 mb-1">{proposal.title}</h3>
          <p className="text-sm text-gray-600 line-clamp-2">{proposal.description}</p>
        </div>

        {/* Voting Power */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-600">Your Voting Power:</span>
            <span className="font-bold text-blue-600">{votingPower.toLocaleString()} FN</span>
          </div>
        </div>

        {/* Vote Options */}
        <div className="mb-6">
          <label className="block text-gray-700 font-medium mb-3">Select your vote:</label>
          
          <div className="space-y-3">
            {/* For */}
            <label
              className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${
                support 
                  ? 'border-green-500 bg-green-50' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="vote"
                checked={support === true}
                onChange={() => setSupport(true)}
                className="sr-only"
              />
              <span className="text-2xl mr-3">👍</span>
              <div className="flex-1">
                <div className="font-medium text-green-700">Vote For</div>
                <div className="text-sm text-gray-500">Support this proposal</div>
              </div>
              {support && (
                <span className="text-green-500">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </span>
              )}
            </label>

            {/* Against */}
            <label
              className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${
                support === false 
                  ? 'border-red-500 bg-red-50' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="vote"
                checked={support === false}
                onChange={() => setSupport(false)}
                className="sr-only"
              />
              <span className="text-2xl mr-3">👎</span>
              <div className="flex-1">
                <div className="font-medium text-red-700">Vote Against</div>
                <div className="text-sm text-gray-500">Reject this proposal</div>
              </div>
              {support === false && (
                <span className="text-red-500">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </span>
              )}
            </label>
          </div>
        </div>

        {/* Warning */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6">
          <div className="flex items-start gap-2">
            <span className="text-yellow-600">⚠️</span>
            <p className="text-sm text-yellow-800">
              Your vote cannot be changed once submitted. Make sure you review the proposal carefully.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleVote}
            disabled={loading || votingPower === 0}
            className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
              votingPower === 0
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : support
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-red-600 text-white hover:bg-red-700'
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Submitting...
              </span>
            ) : (
              `Vote ${support ? 'For' : 'Against'}`
            )}
          </button>
        </div>

        {/* No Power Warning */}
        {votingPower === 0 && (
          <p className="text-center text-sm text-red-500 mt-3">
            You need governance tokens to vote
          </p>
        )}
      </div>
    </div>
  );
};

export default VoteModal;

