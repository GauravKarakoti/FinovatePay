import React, { useState, useEffect } from 'react';
import { getGovernanceParameters, getVotingPower, getGovernanceStats } from '../utils/api';
import { toast } from 'sonner';
import ProposalList from '../components/Governance/ProposalList';
import ProposalDetail from '../components/Governance/ProposalDetail';

const GovernanceDashboard = () => {
  const [activeView, setActiveView] = useState('list');
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [parameters, setParameters] = useState([]);
  const [votingPower, setVotingPower] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      const [paramsRes, statsRes] = await Promise.all([
        getGovernanceParameters(),
        getGovernanceStats()
      ]);
      
      setParameters(paramsRes.data.parameters || []);
      setStats(statsRes.data.stats);
      
      // Get user's voting power
      const user = JSON.parse(localStorage.getItem('user'));
      if (user?.wallet_address) {
        const vpRes = await getVotingPower(user.wallet_address);
        setVotingPower(Number(vpRes.data.votingPower?.votes || 0));
      }
    } catch (error) {
      console.error('Error loading governance data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProposal = (proposal) => {
    setSelectedProposal(proposal);
    setActiveView('detail');
  };

  const handleBack = () => {
    setSelectedProposal(null);
    setActiveView('list');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-2">DAO Governance</h1>
          <p className="text-blue-100">
            Participate in protocol governance by voting on proposals
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-gray-500 text-sm">Your Voting Power</div>
            <div className="text-2xl font-bold text-blue-600">
              {votingPower.toLocaleString()} FN
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-gray-500 text-sm">Total Proposals</div>
            <div className="text-2xl font-bold text-purple-600">
              {stats?.total || 0}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-gray-500 text-sm">Active</div>
            <div className="text-2xl font-bold text-green-600">
              {stats?.active || 0}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-gray-500 text-sm">Executed</div>
            <div className="text-2xl font-bold text-orange-600">
              {stats?.executed || 0}
            </div>
          </div>
        </div>

        {/* Main Content */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : activeView === 'list' ? (
          <ProposalList onSelectProposal={handleSelectProposal} />
        ) : (
          <ProposalDetail 
            proposalId={selectedProposal?.proposal_id} 
            onBack={handleBack} 
          />
        )}

        {/* Protocol Parameters */}
        {activeView === 'list' && parameters.length > 0 && (
          <div className="mt-6 bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Protocol Parameters</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {parameters.map((param) => (
                <div key={param.parameter_name} className="p-3 bg-gray-50 rounded-lg">
                  <div className="text-sm text-gray-500">{param.parameter_name.replace(/_/g, ' ')}</div>
                  <div className="font-semibold text-lg">{param.current_value}</div>
                  {param.is_governable && (
                    <div className="text-xs text-green-600 mt-1">✓ Governable</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GovernanceDashboard;

