import React, { useState, useEffect } from 'react';
import { getProposal, getVotingPower } from '../../utils/api';
import { toast } from 'sonner';
import VoteModal from './VoteModal';

const ProposalDetail = ({ proposalId, onBack }) => {
  const [proposal, setProposal] = useState(null);
  const [votes, setVotes] = useState([]);
  const [userVote, setUserVote] = useState(null);
  const [votingPower, setVotingPower] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showVoteModal, setShowVoteModal] = useState(false);

  useEffect(() => {
    if (proposalId) {
      loadProposal();
      loadVotingPower();
    }
  }, [proposalId]);

  const loadProposal = async () => {
    try {
      setLoading(true);
      const response = await getProposal(proposalId);
      setProposal(response.data.proposal);
      setVotes(response.data.votes || []);
      setUserVote(response.data.userVote);
    } catch (error) {
      console.error('Error loading proposal:', error);
      toast.error('Failed to load proposal');
    } finally {
      setLoading(false);
    }
  };

  const loadVotingPower = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      if (user?.wallet_address) {
        const response = await getVotingPower(user.wallet_address);
        setVotingPower(Number(response.data.votingPower?.votes || 0));
      }
    } catch (error) {
      console.error('Error loading voting power:', error);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      PENDING: 'bg-yellow-100 text-yellow-800',
      ACTIVE: 'bg-green-100 text-green-800',
      SUCCEEDED: 'bg-blue-100 text-blue-800',
      DEFEATED: 'bg-red-100 text-red-800',
      EXECUTED: 'bg-purple-100 text-purple-800',
      CANCELLED: 'bg-gray-100 text-gray-800',
      QUEUED: 'bg-orange-100 text-orange-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const calculatePercentage = (value, total) => {
    if (!total || total === 0) return 0;
    return ((value / total) * 100).toFixed(1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Proposal not found</p>
        <button
          onClick={onBack}
          className="mt-4 text-blue-600 hover:underline"
        >
          Back to proposals
        </button>
      </div>
    );
  }

  const totalVotes = Number(proposal.for_votes || 0) + Number(proposal.against_votes || 0);
  const forPercentage = calculatePercentage(proposal.for_votes, totalVotes);
  const againstPercentage = calculatePercentage(proposal.against_votes, totalVotes);

  return (
    <div className="p-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
      >
        ← Back to proposals
      </button>

      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold">{proposal.title}</h1>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(proposal.status)}`}>
                {proposal.status}
              </span>
            </div>
            <div className="text-gray-500 text-sm">
              Category: {proposal.category?.replace('_', ' ')} • Proposed by: {proposal.proposer_wallet?.slice(0, 10)}...
            </div>
          </div>
          {proposal.status === 'ACTIVE' && votingPower > 0 && (
            <button
              onClick={() => setShowVoteModal(true)}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Cast Vote
            </button>
          )}
        </div>

        {/* Voting Power Info */}
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <div className="flex items-center justify-between">
            <span className="text-blue-800">Your Voting Power:</span>
            <span className="text-xl font-bold text-blue-600">
              {votingPower.toLocaleString()} FN
            </span>
          </div>
          {userVote && (
            <div className="mt-2 text-sm text-blue-600">
              You voted: <span className="font-semibold">{userVote.support_enum}</span>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="mb-6">
          <h3 className="font-semibold text-gray-700 mb-2">Description</h3>
          <p className="text-gray-600 whitespace-pre-wrap">{proposal.description}</p>
        </div>

        {/* Timeline */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-gray-500">Created</div>
            <div className="font-medium">{formatDate(proposal.created_at)}</div>
          </div>
          <div>
            <div className="text-gray-500">Start Block</div>
            <div className="font-medium">{proposal.start_block || 'N/A'}</div>
          </div>
          <div>
            <div className="text-gray-500">End Block</div>
            <div className="font-medium">{proposal.end_block || 'N/A'}</div>
          </div>
          <div>
            <div className="text-gray-500">Execution Time</div>
            <div className="font-medium">{formatDate(proposal.execution_time)}</div>
          </div>
        </div>
      </div>

      {/* Vote Results */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h3 className="font-semibold text-gray-700 mb-4">Vote Results</h3>
        
        <div className="space-y-4">
          {/* For */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-green-600 font-medium">For</span>
              <span className="text-gray-600">
                {Number(proposal.for_votes || 0).toLocaleString()} ({forPercentage}%)
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div
                className="bg-green-500 h-4 rounded-full transition-all duration-300"
                style={{ width: `${forPercentage}%` }}
              ></div>
            </div>
          </div>

          {/* Against */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-red-600 font-medium">Against</span>
              <span className="text-gray-600">
                {Number(proposal.against_votes || 0).toLocaleString()} ({againstPercentage}%)
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div
                className="bg-red-500 h-4 rounded-full transition-all duration-300"
                style={{ width: `${againstPercentage}%` }}
              ></div>
            </div>
          </div>

          {/* Abstain */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-gray-600 font-medium">Abstain</span>
              <span className="text-gray-600">
                {Number(proposal.abstain_votes || 0).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t text-sm text-gray-500">
          <div className="flex justify-between">
            <span>Total Votes:</span>
            <span className="font-medium">{totalVotes.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Quorum Required:</span>
            <span className="font-medium">{Number(proposal.quorum_required || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Recent Votes */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="font-semibold text-gray-700 mb-4">Recent Votes ({votes.length})</h3>
        
        {votes.length === 0 ? (
          <p className="text-gray-500 text-center py-4">No votes yet</p>
        ) : (
          <div className="space-y-3">
            {votes.slice(0, 10).map((vote, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className={`text-lg ${vote.support ? '👍' : '👎'}`}>
                    {vote.support ? '👍' : '👎'}
                  </span>
                  <div>
                    <div className="font-medium text-sm">
                      {vote.voter_wallet?.slice(0, 6)}...{vote.voter_wallet?.slice(-4)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDate(vote.created_at)}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-medium ${vote.support ? 'text-green-600' : 'text-red-600'}`}>
                    {vote.support_enum}
                  </div>
                  <div className="text-xs text-gray-500">
                    {Number(vote.vote_weight || 0).toLocaleString()} votes
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Vote Modal */}
      {showVoteModal && (
        <VoteModal
          proposal={proposal}
          votingPower={votingPower}
          onClose={() => setShowVoteModal(false)}
          onVoteSubmitted={() => {
            setShowVoteModal(false);
            loadProposal();
          }}
        />
      )}
    </div>
  );
};

export default ProposalDetail;

