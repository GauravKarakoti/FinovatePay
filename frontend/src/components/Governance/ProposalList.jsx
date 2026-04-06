import React, { useState, useEffect } from 'react';
import { getProposals, getGovernanceStats } from '../../utils/api';
import { toast } from 'sonner';

const ProposalList = ({ onSelectProposal }) => {
  const [proposals, setProposals] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    loadProposals();
    loadStats();
  }, [filter]);

  const loadProposals = async () => {
    try {
      setLoading(true);
      const params = filter !== 'ALL' ? { status: filter } : {};
      const response = await getProposals(params);
      setProposals(response.data.proposals || []);
    } catch (error) {
      console.error('Error loading proposals:', error);
      toast.error('Failed to load proposals');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await getGovernanceStats();
      setStats(response.data.stats);
    } catch (error) {
      console.error('Error loading stats:', error);
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
      EXPIRED: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getCategoryIcon = (category) => {
    const icons = {
      PARAMETER_UPDATE: '⚙️',
      FEE_UPDATE: '💰',
      TREASURY_UPDATE: '🏦',
      EMERGENCY: '🚨',
      UPGRADE: '⬆️',
      GENERAL: '📝',
    };
    return icons[category] || '📝';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="p-6">
      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {['ALL', 'ACTIVE', 'PENDING', 'SUCCEEDED', 'DEFEATED', 'EXECUTED'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Proposals List */}
      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-500">Loading proposals...</p>
        </div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-8 bg-white rounded-lg">
          <div className="text-4xl mb-2">📭</div>
          <p className="text-gray-500">No proposals found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {proposals.map((proposal) => (
            <div
              key={proposal.proposal_id}
              onClick={() => onSelectProposal?.(proposal)}
              className="bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{getCategoryIcon(proposal.category)}</span>
                    <h3 className="font-semibold text-lg">{proposal.title}</h3>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(proposal.status)}`}>
                      {proposal.status}
                    </span>
                  </div>
                  <p className="text-gray-600 text-sm mb-2 line-clamp-2">
                    {proposal.description}
                  </p>
                  <div className="flex gap-4 text-sm text-gray-500">
                    <span>Category: {proposal.category?.replace('_', ' ')}</span>
                    <span>Created: {formatDate(proposal.created_at)}</span>
                  </div>
                </div>
                <div className="text-right ml-4">
                  <div className="text-sm text-gray-500 mb-1">Votes</div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-green-600 font-medium">
                      👍 {Number(proposal.for_votes || 0).toLocaleString()}
                    </span>
                    <span className="text-red-600 font-medium">
                      👎 {Number(proposal.against_votes || 0).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProposalList;

