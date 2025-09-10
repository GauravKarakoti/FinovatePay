import React from 'react';

const EscrowStatus = ({ invoice, onConfirm, onDispute }) => {
    // Gracefully handle the case where no invoice is selected
    if (!invoice) {
        return (
            <div className="bg-white rounded-lg shadow-md p-4 h-full flex items-center justify-center">
                <p className="text-gray-500 text-center">Select an invoice to see its escrow details.</p>
            </div>
        );
    }
    
    const status = invoice.escrow_status;
    
    // Updated status configurations
    const statusConfig = {
        deposited: {
            label: 'Funds in Escrow',
            color: 'text-blue-600 bg-blue-100',
            // Inform the buyer they are waiting for the seller
            action: 'Funds are held securely. Waiting for the seller to confirm shipment.'
        },
        // NEW configuration for the 'shipped' status
        shipped: {
            label: 'Shipped',
            color: 'text-purple-600 bg-purple-100',
            // Prompt the buyer to take the next action
            action: 'The seller has confirmed shipment. Please review and release the funds upon satisfaction.'
        },
        released: {
            label: 'Released',
            color: 'text-green-600 bg-green-100',
            action: 'Completed'
        },
        disputed: {
            label: 'Disputed',
            color: 'text-red-600 bg-red-100',
            action: 'Under review by an arbiter.'
        },
    };

    const config = statusConfig[status] || {label: 'Unknown', color: 'bg-gray-100', action: 'Status not recognized'};

    return (
        <div className="bg-white rounded-lg shadow-md p-4">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Escrow Details</h3>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
                    {config.label}
                </span>
            </div>

            <p className="text-gray-600 mb-4 min-h-[40px]">{config.action}</p>

            <div className="flex space-x-2">
                {/* CHANGE: The 'Confirm & Release' button now only appears when status is 'shipped' 
                */}
                {status === 'shipped' && onConfirm && (
                    <button
                        onClick={() => onConfirm(invoice)}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md"
                    >
                        Confirm & Release Funds
                    </button>
                )}
                
                {/* CHANGE: Allow dispute during 'deposited' and 'shipped' states
                */}
                {(status === 'deposited' || status === 'shipped') && onDispute && (
                    <button
                        onClick={() => {
                            const reason = prompt('Please enter the reason for the dispute:');
                            if (reason) onDispute(invoice, reason);
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md"
                    >
                        Raise Dispute
                    </button>
                )}
            </div>

            {status === 'disputed' && (
                <div className="mt-4 p-3 bg-yellow-50 rounded-md">
                    <p className="text-yellow-800 text-sm">
                        This invoice is under dispute. An administrator will review and resolve the case.
                    </p>
                </div>
            )}
        </div>
    );
};

export default EscrowStatus;