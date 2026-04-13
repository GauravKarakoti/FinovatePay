import { useState, useEffect } from 'react';
import { api } from '../../utils/api';

const RiskAnalytics = ({ userId, onClose }) => {
  const [riskData, setRiskData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRecalculating, setIsRecalculating] = useState(false);

  useEffect(() => {
    fetchRiskProfile();
  }, [userId]);

  const fetchRiskProfile = async () => {
    try {
      setLoading(true);
      // Remove '/api' from the beginning of these strings
      const endpoint = userId ? `/credit-risk/${userId}` : '/credit-risk/me'; 
      const response = await api.get(endpoint);
      
      if (response.data.success) {
        setRiskData(response.data.data);
      } else {
        setError(response.data.error || 'Failed to load risk profile');
      }
    } catch (err) {
      console.error('Error fetching risk profile:', err);
      setError(err.response?.data?.error || 'Failed to load risk profile');
    } finally {
      setLoading(false);
    }
  };

  const handleRecalculate = async () => {
    try {
      setIsRecalculating(true);
      // Remove '/api' from the beginning of this string
      const response = await api.post('/credit-risk/calculate'); 
      
      if (response.data.success) {
        setRiskData(response.data.data);
      }
    } catch (err) {
      console.error('Error recalculating risk profile:', err);
    } finally {
      setIsRecalculating(false);
    }
  };

  const getRiskColor = (score) => {
    if (score <= 20) return 'text-green-600';
    if (score <= 35) return 'text-blue-600';
    if (score <= 50) return 'text-yellow-600';
    if (score <= 70) return 'text-orange-600';
    return 'text-red-600';
  };

  const getRiskBgColor = (score) => {
    if (score <= 20) return 'bg-green-100';
    if (score <= 35) return 'bg-blue-100';
    if (score <= 50) return 'bg-yellow-100';
    if (score <= 70) return 'bg-orange-100';
    return 'bg-red-100';
  };

  const getImpactColor = (impact) => {
    if (impact === 'positive') return 'text-green-600';
    if (impact === 'negative') return 'text-red-600';
    return 'text-gray-600';
  };

  const getImpactIcon = (impact) => {
    if (impact === 'positive') return '↑';
    if (impact === 'negative') return '↓';
    return '→';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 animate-pulse">
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-finovate-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error && !riskData) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="text-center text-red-500">
          <p>{error}</p>
          <button 
            onClick={fetchRiskProfile}
            className="mt-2 text-sm text-finovate-blue-600 hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { 
    riskScore, 
    riskScoreChange, 
    riskCategoryLabel, 
    riskCategoryColor,
    componentScores, 
    dynamicRate, 
    factors, 
    modelInfo 
  } = riskData || {};

  const riskChangeColor = riskScoreChange > 0 ? 'text-red-500' : riskScoreChange < 0 ? 'text-green-500' : 'text-gray-500';

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-800">AI Risk Assessment</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRecalculate}
            disabled={isRecalculating}
            className="text-sm text-finovate-blue-600 hover:text-finovate-blue-800 disabled:opacity-50"
          >
            {isRecalculating ? 'Recalculating...' : 'Recalculate'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="ml-4 text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Risk Score Display */}
      <div className="flex items-center justify-center mb-6">
        <div className="relative w-36 h-36">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="72"
              cy="72"
              r="64"
              stroke="#e5e7eb"
              strokeWidth="12"
              fill="none"
            />
            <circle
              cx="72"
              cy="72"
              r="64"
              stroke={riskScore <= 20 ? '#22c55e' : riskScore <= 35 ? '#3b82f6' : riskScore <= 50 ? '#eab308' : riskScore <= 70 ? '#f97316' : '#ef4444'}
              strokeWidth="12"
              fill="none"
              strokeDasharray={`${(riskScore / 100) * 402} 402`}
              strokeLinecap="round"
              className="transition-all duration-1000"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-4xl font-bold ${getRiskColor(riskScore)}`}>{riskScore || 0}</span>
            <span className="text-sm text-gray-500">/ 100</span>
          </div>
        </div>
      </div>

      {/* Risk Category and Change */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <div className={`px-4 py-1 rounded-full ${getRiskBgColor(riskScore)}`}>
          <span className={`font-semibold ${getRiskColor(riskScore)}`}>
            {riskCategoryLabel || 'Unknown'}
          </span>
        </div>
        {riskScoreChange !== 0 && (
          <span className={`text-sm font-medium ${riskChangeColor}`}>
            {riskScoreChange > 0 ? '↑' : '↓'} {Math.abs(riskScoreChange)} pts
          </span>
        )}
      </div>

      {/* Dynamic Interest Rate */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 mb-6 border border-blue-100">
        <div className="text-center">
          <p className="text-sm text-gray-600 mb-1">Dynamic Interest Rate</p>
          <p className="text-3xl font-bold text-blue-600">
            {dynamicRate?.rate || 0}%
          </p>
          <div className="flex justify-center gap-4 mt-2 text-xs text-gray-500">
            <span>Base: {dynamicRate?.base || 0}%</span>
            <span>|</span>
            <span>Adjustment: {dynamicRate?.adjustment >= 0 ? '+' : ''}{dynamicRate?.adjustment || 0}%</span>
          </div>
        </div>
      </div>

      {/* Component Scores */}
      <div className="border-t pt-4 mb-4">
        <h4 className="text-sm font-medium text-gray-600 mb-3">AI Score Components</h4>
        <div className="space-y-3">
          {/* Behavioral */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Behavioral Analysis</span>
              <span className="font-medium">{componentScores?.behavioral?.score || 0}/100</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-purple-500 h-2 rounded-full" 
                style={{ width: `${componentScores?.behavioral?.score || 0}%` }}
              ></div>
            </div>
            <span className="text-xs text-gray-400">{componentScores?.behavioral?.weight}% weight</span>
          </div>

          {/* Payment Velocity */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Payment Velocity</span>
              <span className="font-medium">{componentScores?.paymentVelocity?.score || 0}/100</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full" 
                style={{ width: `${componentScores?.paymentVelocity?.score || 0}%` }}
              ></div>
            </div>
            <span className="text-xs text-gray-400">{componentScores?.paymentVelocity?.weight}% weight</span>
          </div>

          {/* Market Alignment */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Market Alignment</span>
              <span className="font-medium">{componentScores?.marketAlignment?.score || 0}/100</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-teal-500 h-2 rounded-full" 
                style={{ width: `${componentScores?.marketAlignment?.score || 0}%` }}
              ></div>
            </div>
            <span className="text-xs text-gray-400">{componentScores?.marketAlignment?.weight}% weight</span>
          </div>

          {/* Financial Health */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Financial Health</span>
              <span className="font-medium">{componentScores?.financialHealth?.score || 0}/100</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-green-500 h-2 rounded-full" 
                style={{ width: `${componentScores?.financialHealth?.score || 0}%` }}
              ></div>
            </div>
            <span className="text-xs text-gray-400">{componentScores?.financialHealth?.weight}% weight</span>
          </div>

          {/* Traditional Score */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Traditional Credit Score</span>
              <span className="font-medium">{componentScores?.traditionalScore?.score || 0}/100</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-indigo-500 h-2 rounded-full" 
                style={{ width: `${componentScores?.traditionalScore?.score || 0}%` }}
              ></div>
            </div>
            <span className="text-xs text-gray-400">{componentScores?.traditionalScore?.weight}% weight</span>
          </div>
        </div>
      </div>

      {/* Risk Factors */}
      <div className="border-t pt-4 mb-4">
        <h4 className="text-sm font-medium text-gray-600 mb-3">Risk Factors</h4>
        <div className="space-y-2">
          {factors?.map((factor, index) => (
            <div 
              key={index} 
              className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
            >
              <div className="flex items-center gap-2">
                <span className={`text-lg ${getImpactColor(factor.impact)}`}>
                  {getImpactIcon(factor.impact)}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-700">{factor.name}</p>
                  <p className="text-xs text-gray-500">{factor.description}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-sm font-semibold ${getImpactColor(factor.impact)}`}>
                  {factor.score}
                </p>
                <p className="text-xs text-gray-400">{factor.weight}% weight</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Model Info */}
      <div className="border-t pt-4">
        <div className="flex flex-wrap gap-2 justify-center">
          <span className="text-xs text-gray-500">
            Model: {modelInfo?.version || 'v1.0'}
          </span>
          <span className="text-gray-300">|</span>
          <span className="text-xs text-gray-500">
            Confidence: {((modelInfo?.confidence || 0) * 100).toFixed(0)}%
          </span>
          <span className="text-gray-300">|</span>
          <span className="text-xs text-gray-500">
            Last Updated: {modelInfo?.lastCalculated ? new Date(modelInfo.lastCalculated).toLocaleDateString() : 'N/A'}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="border-t mt-4 pt-4">
        <div className="flex flex-wrap gap-2 justify-center">
          <span className="text-xs text-gray-500">Risk Score:</span>
          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">0-20 Excellent</span>
          <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">21-35 Good</span>
          <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded">36-50 Moderate</span>
          <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded">51-70 High</span>
          <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">71-100 Very High</span>
        </div>
      </div>
    </div>
  );
};

export default RiskAnalytics;

