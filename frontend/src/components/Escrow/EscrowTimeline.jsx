import React from 'react';

const EscrowTimeline = ({ events }) => {
  const getStatusIcon = (status) => {
      switch (status) {
          case 'created': return '📝';
          case 'deposited': return '💰';
          case 'shipped': return '🚚'; // New Icon
          case 'released': return '✅';
          case 'disputed': return '⚖️';
          case 'expired': return '⏰';
          default: return '🔹';
      }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <h3 className="text-lg font-semibold mb-4">Escrow Timeline</h3>
      
      <div className="space-y-4">
        {events.map((event, index) => (
          <div key={index} className="flex">
            <div className="flex flex-col items-center mr-4">
              <div className="w-8 h-8 rounded-full bg-finovate-blue-100 flex items-center justify-center">
                <span>{getStatusIcon(event.status)}</span>
              </div>
              {index < events.length - 1 && (
                <div className="w-0.5 h-12 bg-gray-200 mt-2"></div>
              )}
            </div>
            
            <div className="flex-1 pb-4">
              <p className="font-medium">{event.title}</p>
              <p className="text-sm text-gray-500">{event.description}</p>
              <p className="text-xs text-gray-400 mt-1">{event.timestamp}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EscrowTimeline;