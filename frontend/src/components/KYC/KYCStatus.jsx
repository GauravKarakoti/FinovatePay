const KYCStatus = ({ status, riskLevel, details, onReverify }) => {
  const statusConfig = {
    not_started: {
      label: 'Not Verified',
      color: 'text-gray-800 bg-gray-100',
      icon: '⚪'
    },
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

  // Helper to safely parse and extract details
  const renderDetails = () => {
    if (!details) return null;

    let data = details;
    // If details is a JSON string, try to parse it
    if (typeof details === 'string') {
      try {
        data = JSON.parse(details);
      } catch (e) {
        // If parsing fails, return as simple text
        return <p className="text-sm text-gray-600">{details}</p>;
      }
    }

    // Check if it's the specific KYC object structure we expect
    if (data.name || data.full_address) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-3">
          <div className="col-span-1">
            <p className="text-gray-500 text-xs">Full Name</p>
            <p className="font-medium text-gray-900">{data.name || 'N/A'}</p>
          </div>
          
          <div className="col-span-1">
            <p className="text-gray-500 text-xs">Date of Birth</p>
            <p className="font-medium text-gray-900">{data.date_of_birth || 'N/A'}</p>
          </div>

          <div className="col-span-1">
            <p className="text-gray-500 text-xs">Gender</p>
            <p className="font-medium text-gray-900">
              {data.gender === 'M' ? 'Male' : data.gender === 'F' ? 'Female' : data.gender || 'N/A'}
            </p>
          </div>

          <div className="col-span-1">
             <p className="text-gray-500 text-xs">Care Of</p>
             <p className="font-medium text-gray-900">{data.care_of || 'N/A'}</p>
          </div>

          <div className="col-span-1 md:col-span-2">
            <p className="text-gray-500 text-xs">Address</p>
            <p className="font-medium text-gray-900 break-words">{data.full_address || 'N/A'}</p>
          </div>
          
          <div className="col-span-1 md:col-span-2 pt-2 border-t border-gray-100 mt-2">
             <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Reference ID: {data.reference_id}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${data.status === 'VALID' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                  {data.message || data.status}
                </span>
             </div>
          </div>
        </div>
      );
    }

    // Fallback for generic object
    return (
      <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto text-gray-600">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">      
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
        <div className="mb-6 border rounded-md p-4 bg-gray-50/50">
          <h3 className="font-medium mb-2 text-gray-900">Identity Details</h3>
          {renderDetails()}
        </div>
      )}
      
      {(status === 'failed' || status === 'expired' || status === 'not_started') && (
        <button
          onClick={onReverify}
          className="px-4 py-2 bg-finovate-blue-600 text-white rounded-md hover:bg-finovate-blue-700 w-full md:w-auto transition-colors"
        >
          {status === 'not_started' ? 'Start Verification' : 'Restart Verification'}
        </button>
      )}
      
      {status === 'pending' && (
        <div className="text-sm text-gray-500 bg-blue-50 p-3 rounded-md">
          Your verification is being processed. This usually takes 1-2 business days.
        </div>
      )}
    </div>
  );
};

export default KYCStatus;