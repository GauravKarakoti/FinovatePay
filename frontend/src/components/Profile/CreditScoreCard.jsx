import { useState, useEffect } from 'react';
import { api } from '../../utils/api';

const CreditScoreCard = ({ userId, showDetails = true, compact = false }) => {
  const [scoreData, setScoreData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRecalculating, setIsRecalculating] = useState(false);

  useEffect(() => {
    fetchScore();
  }, [userId]);

  const fetchScore = async () => {
    try {
      setLoading(true);
      const endpoint = userId ? `/api/credit-scores/${userId}` : '/api/credit-scores/me';
      const response = await api.get(endpoint);
      
      if (response.data.success) {
        setScoreData(response.data.data);
      } else {
        setError(response.data.error || 'Failed to load credit score');
      }
    } catch (err) {
      console.error('Error fetching credit score:', err);
      setError(err.response?.data?.error || 'Failed to load credit score');
    } finally {
      setLoading(false);
    }
  };

  const handleRecalculate = async () => {
    try {
      setIsRecalculating(true);
      const response = await api.post('/api/credit-scores/calculate');
      
      if (response.data.success) {
        setScoreData(response.data.data);
      }
    } catch (err) {
      console.error('Error recalculating score:', err);
    } finally {
      setIsRecalculating(false);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 80) return 'text-blue-600';
    if (score >= 70) return 'text-yellow-600';
    if (score >= 60) return 'text-orange-600';
    return 'text-red-600';
  };

  const getScoreBgColor = (score) => {
    if (score >= 90) return 'bg-green-100';
    if (score >= 80) return 'bg-blue-100';
    if (score >= 70) return 'bg-yellow-100';
    if (score >= 60) return 'bg-orange-100';
    return 'bg-red-100';
  };

  const getScoreRingColor = (score) => {
    if (score >= 90) return '#22c55e';
    if (score >= 80) return '#3b82f6';
    if (score >= 70) return '#eab308';
    if (score >= 60) return '#f97316';
    return '#ef4444';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 animate-pulse">
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-finovate-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error && !scoreData) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="text-center text-red-500">
          <p>{error}</p>
          <button 
            onClick={fetchScore}
            className="mt-2 text-sm text-finovate-blue-600 hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { score, scoreChange, grade, breakdown, stats } = scoreData || {};
  const scoreChangeColor = scoreChange > 0 ? 'text-green-500' : scoreChange < 0 ? 'text-red-500' : 'text-gray-500';

  if (compact) {
    return (
      <div className={`rounded-lg p-4 ${getScoreBgColor(score)}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Credit Score</p>
            <p className={`text-2xl font-bold ${getScoreColor(score)}`}>{score || 0}</p>
          </div>
          <div className={`text-lg font-semibold px-3 py-1 rounded-full ${getScoreBgColor(score)}`}>
            {grade?.grade || '-'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-800">Credit Score</h3>
        <button
          onClick={handleRecalculate}
          disabled={isRecalculating}
          className="text-sm text-finovate-blue-600 hover:text-finovate-blue-800 disabled:opacity-50"
        >
          {isRecalculating ? 'Recalculating...' : 'Recalculate'}
        </button>
      </div>

      {/* Score Display */}
      <div className="flex items-center justify-center mb-6">
        <div className="relative w-32 h-32">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="64"
              cy="64"
              r="56"
              stroke="#e5e7eb"
              strokeWidth="12"
              fill="none"
            />
            <circle
              cx="64"
              cy="64"
              r="56"
              stroke={getScoreRingColor(score)}
              strokeWidth="12"
              fill="none"
              strokeDasharray={`${(score / 100) * 352} 352`}
              strokeLinecap="round"
              className="transition-all duration-1000"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-3xl font-bold ${getScoreColor(score)}`}>{score || 0}</span>
            <span className="text-sm text-gray-500">/ 100</span>
          </div>
        </div>
      </div>

      {/* Grade and Change */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <div className={`px-4 py-1 rounded-full ${getScoreBgColor(score)}`}>
          <span className={`font-semibold ${getScoreColor(score)}`}>Grade: {grade?.grade || '-'}</span>
        </div>
        {scoreChange !== 0 && (
          <span className={`text-sm font-medium ${scoreChangeColor}`}>
            {scoreChange > 0 ? '↑' : '↓'} {Math.abs(scoreChange)} pts
          </span>
        )}
      </div>

      {showDetails && (
        <>
          {/* Score Breakdown */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-600 mb-3">Score Breakdown</h4>
            <div className="space-y-3">
              {/* Payment History */}
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Payment History</span>
                  <span className="font-medium">{breakdown?.paymentHistory?.score || 0}/100</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full" 
                    style={{ width: `${breakdown?.paymentHistory?.score || 0}%` }}
                  ></div>
                </div>
                <span className="text-xs text-gray-400">{breakdown?.paymentHistory?.weight}% weight</span>
              </div>

              {/* Dispute Ratio */}
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Dispute Ratio</span>
                  <span className="font-medium">{breakdown?.disputeRatio?.score || 0}/100</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-purple-500 h-2 rounded-full" 
                    style={{ width: `${breakdown?.disputeRatio?.score || 0}%` }}
                  ></div>
                </div>
                <span className="text-xs text-gray-400">{breakdown?.disputeRatio?.weight}% weight</span>
              </div>

              {/* KYC */}
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">KYC Status</span>
                  <span className="font-medium">{breakdown?.kyc?.score || 0}/100</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-green-500 h-2 rounded-full" 
                    style={{ width: `${breakdown?.kyc?.score || 0}%` }}
                  ></div>
                </div>
                <span className="text-xs text-gray-400">{breakdown?.kyc?.weight}% weight</span>
              </div>

              {/* Transaction Volume */}
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Transaction Volume</span>
                  <span className="font-medium">{breakdown?.transactionVolume?.score || 0}/100</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-yellow-500 h-2 rounded-full" 
                    style={{ width: `${breakdown?.transactionVolume?.score || 0}%` }}
                  ></div>
                </div>
                <span className="text-xs text-gray-400">{breakdown?.transactionVolume?.weight}% weight</span>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="border-t mt-4 pt-4">
            <h4 className="text-sm font-medium text-gray-600 mb-3">Statistics</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Total Transactions</p>
                <p className="font-medium">{stats?.totalTransactions || 0}</p>
              </div>
              <div>
                <p className="text-gray-500">Completed</p>
                <p className="font-medium text-green-600">{stats?.completedPayments || 0}</p>
              </div>
              <div>
                <p className="text-gray-500">Disputed</p>
                <p className="font-medium text-red-600">{stats?.disputedPayments || 0}</p>
              </div>
              <div>
                <p className="text-gray-500">Total Volume</p>
                <p className="font-medium">${parseFloat(stats?.totalVolume || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-500">KYC Status</p>
                <p className="font-medium capitalize">{stats?.kycStatus || 'none'}</p>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="border-t mt-4 pt-4">
            <div className="flex flex-wrap gap-2 justify-center">
              <span className="text-xs text-gray-500">Score Range:</span>
              <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">90+ Excellent</span>
              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">80-89 Very Good</span>
              <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded">70-79 Good</span>
              <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded">60-69 Fair</span>
              <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">Below 60 Poor</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CreditScoreCard;
