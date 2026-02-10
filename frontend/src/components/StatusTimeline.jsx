import React from 'react';

const steps = [
  { id: 'draft', label: 'Draft Created' },
  { id: 'signed', label: 'Signed (On-Chain)' },
  { id: 'funded', label: 'Escrow Funded' },
  { id: 'complete', label: 'Funds Released' },
];

const StatusTimeline = ({ currentStatus }) => {
  // Helper to determine step state: 'complete', 'current', or 'upcoming'
  const getStepStatus = (stepId) => {
    const statusOrder = ['draft', 'signed', 'funded', 'complete'];
    const currentIndex = statusOrder.indexOf(currentStatus.toLowerCase());
    const stepIndex = statusOrder.indexOf(stepId);

    if (stepIndex < currentIndex) return 'complete';
    if (stepIndex === currentIndex) return 'current';
    return 'upcoming';
  };

  return (
    <div className="w-full py-6">
      <div className="flex items-center justify-between w-full">
        {steps.map((step, index) => {
          const status = getStepStatus(step.id);
          return (
            <div key={step.id} className="relative flex flex-col items-center flex-1">
              {/* Connector Line (behind the circles) */}
              {index !== 0 && (
                <div className={`absolute top-4 right-[50%] w-full h-1 
                  ${status === 'complete' ? 'bg-green-500' : 'bg-gray-200'}`} 
                />
              )}
              
              {/* Status Circle */}
              <div className={`z-10 flex items-center justify-center w-8 h-8 rounded-full border-2 
                ${status === 'complete' || status === 'current' ? 'border-green-500 bg-green-500 text-white' : 'border-gray-300 bg-white text-gray-500'}`}>
                {status === 'complete' ? (
                  <span>✓</span>
                ) : (
                  <span className="text-xs">{index + 1}</span>
                )}
              </div>
              
              {/* Label */}
              <div className={`mt-2 text-xs font-medium uppercase ${status === 'current' ? 'text-green-600' : 'text-gray-500'}`}>
                {step.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StatusTimeline;