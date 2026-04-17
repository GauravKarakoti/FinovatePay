import { useState, useEffect } from 'react';
import { getGovernanceParameters, getVotingPower, getGovernanceStats } from '../utils/api';
import { delegateVotes } from '../utils/web3'; // Import the new web3 function
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
  const [userRole, setUserRole] = useState('investor');
  
  // New state for delegation
  const [delegatee, setDelegatee] = useState('');
  const [isDelegating, setIsDelegating] = useState(false);

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
      
      // Get user data
      const user = JSON.parse(localStorage.getItem('user'));
      if (user) {
        setUserRole(user.role || 'user');
        
        if (user.wallet_address) {
          const vpRes = await getVotingPower(user.wallet_address);
          let rawVotes = vpRes.data.votingPower?.votes || 0;
          
          // Normalize if the votes are returned in Wei (18 decimals)
          let parsedVotes = 0;
          try {
            if (rawVotes.toString().length > 15) {
              parsedVotes = Number(BigInt(rawVotes) / 1000000000000000000n);
            } else {
              parsedVotes = Number(rawVotes);
            }
          } catch (e) {
            parsedVotes = Number(rawVotes);
          }
          
          setVotingPower(parsedVotes);
        }
      }
    } catch (error) {
      console.error('Error loading governance data:', error);
      toast.error('Failed to load governance data');
    } finally {
      setLoading(false);
    }
  };

  // New handler for delegation
  const handleDelegate = async () => {
    try {
      setIsDelegating(true);
      
      // Default to self-delegation if input is empty
      const user = JSON.parse(localStorage.getItem('user'));
      const targetAddress = delegatee.trim() || user?.wallet_address;
      
      if (!targetAddress) {
        toast.error("Could not determine address for delegation");
        return;
      }

      toast.loading(`Delegating votes to ${targetAddress.slice(0, 6)}...`);
      
      await delegateVotes(targetAddress);
      
      toast.dismiss();
      toast.success("Successfully delegated votes!");
      setDelegatee('');
      
      // Refresh the voting power stats
      await loadData();
    } catch (error) {
      toast.dismiss();
      console.error('Delegation failed:', error);
      toast.error(error.reason || error.message || "Failed to delegate votes");
    } finally {
      setIsDelegating(false);
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

  // Extract threshold and calculate eligibility
  const getProposalThreshold = () => {
    const param = parameters.find(p => p.parameter_name === 'proposalThreshold');
    if (!param) return 100000; // Fallback
    try {
      // Normalize from Wei
      return Number(BigInt(param.current_value) / 1000000000000000000n);
    } catch (e) {
      return 100000;
    }
  };

  const proposalThreshold = getProposalThreshold();
  const missingForProposal = Math.max(0, proposalThreshold - votingPower);
  
  const canVote = votingPower > 0;
  const hasRequiredRole = ['admin', 'investor'].includes(userRole);
  const canPropose = votingPower >= proposalThreshold && hasRequiredRole;

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

        {/* Eligibility Status Card */}
        {activeView === 'list' && !loading && (
          <div className="bg-white p-6 rounded-lg shadow mb-6 border-l-4 border-blue-500">
            <h2 className="text-xl font-semibold mb-4">Governance Eligibility</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 border border-gray-100 bg-gray-50 rounded-lg flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-gray-800">Voting Rights</h3>
                    {canVote ? (
                      <span className="text-green-600 font-medium text-sm flex items-center">✅ Eligible</span>
                    ) : (
                      <span className="text-gray-500 font-medium text-sm flex items-center">❌ Not Eligible</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-2">
                    {canVote 
                      ? "You have voting power and can participate in active proposals." 
                      : "You need at least 1 FN token voting power to vote on proposals. If you hold tokens, you must delegate them to activate your voting power."}
                  </p>
                </div>
                
                {/* Delegation UI injected here */}
                <div className="mt-4 pt-3 border-t border-gray-200">
                  <p className="text-xs text-gray-500 mb-2">Activate voting power by delegating to yourself or another address:</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="0x... (Leave empty for self)"
                      value={delegatee}
                      onChange={(e) => setDelegatee(e.target.value)}
                      className="flex-1 text-sm border border-gray-300 p-2 rounded-md outline-none focus:border-blue-500"
                      disabled={isDelegating}
                    />
                    <button
                      onClick={handleDelegate}
                      disabled={isDelegating}
                      className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:bg-gray-400 whitespace-nowrap transition-colors"
                    >
                      {isDelegating ? 'Processing...' : 'Delegate'}
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="p-4 border border-gray-100 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-gray-800">Proposal Creation</h3>
                  {canPropose ? (
                    <span className="text-green-600 font-medium text-sm flex items-center">✅ Eligible</span>
                  ) : (
                    <span className="text-yellow-600 font-medium text-sm flex items-center">⚠️ Action Required</span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-2">
                  {canPropose 
                    ? "You have sufficient voting power and the correct role to create new governance proposals." 
                    : "You do not meet the protocol requirements to submit a new proposal yet:"}
                </p>
                
                {!canPropose && (
                  <ul className="mt-3 space-y-2">
                    {!hasRequiredRole && (
                      <li className="text-xs text-red-500 flex items-start">
                        <span className="mr-2">•</span> 
                        <span>Role requirement: You must be an 'investor'. Your current role is '{userRole}'.</span>
                      </li>
                    )}
                    {votingPower < proposalThreshold && (
                      <li className="text-xs text-red-500 flex items-start">
                        <span className="mr-2">•</span> 
                        <span>Power requirement: You need {missingForProposal.toLocaleString()} more FN tokens to reach the {proposalThreshold.toLocaleString()} threshold.</span>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

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
                  <div className="font-semibold text-lg">
                    {/* Make extremely large WEI values readable */}
                    {param.current_value.length > 15 
                      ? Number(BigInt(param.current_value) / 1000000000000000000n).toLocaleString() 
                      : param.current_value}
                  </div>
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