import React from 'react';

const KYCStatus = ({ status, riskLevel, details, onReverify }) => {
  const statusConfig = {
    pending: {
      label: 'Pending Review',
      color: 'text-yellow-800 bg-yellow-100',
      icon: '⏳'
    },
    verified: {
      label: 'Verified',
      color: 'text-green-800 bg-green-100',
      icon: '✅'
    },
    failed: {
      label: 'Verification Failed',
      color: 'text-red-800 bg-red-100',
      icon: '❌'
    },
    expired: {
      label: 'Expired',
      color: 'text-gray-800 bg-gray-100',
      icon: '📅'
    }
  };

  const riskConfig = {
    low: {
      label: 'Low Risk',
      color: 'text-green-800 bg-green-100'
    },
    medium: {
      label: 'Medium Risk',
      color: 'text-yellow-800 bg-yellow-100'
    },
    high: {
      label: 'High Risk',
      color: 'text-red-800 bg-red-100'
    }
  };

  const config = statusConfig[status] || statusConfig.pending;
  const risk = riskConfig[riskLevel] || riskConfig.medium;

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold mb-6">KYC Status</h2>
      
      <div className="flex items-center mb-6">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${config.color} mr-4`}>
          {config.icon}
        </div>
        <div>
          <h3 className="font-medium">Verification Status</h3>
          <p className={`text-sm font-medium ${config.color} inline-block px-2 py-1 rounded-full`}>
            {config.label}
          </p>
        </div>
      </div>
      
      <div className="mb-6">
        <h3 className="font-medium mb-2">Risk Assessment</h3>
        <p className={`text-sm font-medium ${risk.color} inline-block px-2 py-1 rounded-full`}>
          {risk.label}
        </p>
      </div>
      
      {details && (
        <div className="mb-6">
          <h3 className="font-medium mb-2">Details</h3>
          <p className="text-sm text-gray-600">{details}</p>
        </div>
      )}
      
      {(status === 'failed' || status === 'expired') && (
        <button
          onClick={onReverify}
          className="px-4 py-2 bg-finovate-blue-600 text-white rounded-md hover:bg-finovate-blue-700"
        >
          Restart Verification
        </button>
      )}
      
      {status === 'pending' && (
        <div className="text-sm text-gray-500">
          Your verification is being processed. This usually takes 1-2 business days.
        </div>
      )}
    </div>
  );
};

export default KYCStatus;