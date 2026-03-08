import React, { useState, useEffect } from 'react';
import { getMultiSigApprovals, approveMultiSig } from '../../utils/api';
import { toast } from 'sonner';

const EscrowStatus = ({ invoice, onConfirm, onDispute }) => {
    const [multiSigData, setMultiSigData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [approving, setApproving] = useState(false);

    // Gracefully handle the case where no invoice is selected
    if (!invoice) {
        return (
            <div className="bg-white rounded-lg shadow-md p-4 h-full flex items-center justify-center">
                <p className="text-gray-500 text-center">Select an invoice to see its escrow details.</p>
            </div>
        );
    }

    const status = invoice.escrow_status;

    // Fetch multi-sig approval data when invoice changes
    useEffect(() => {
        const fetchMultiSigData = async () => {
            if (invoice?.invoice_id && (status === 'deposited' || status === 'funded')) {
                try {
                    setLoading(true);
                    const response = await getMultiSigApprovals(invoice.invoice_id);
                    setMultiSigData(response.data);
                } catch (error) {
                    console.error('Error fetching multi-sig data:', error);
                } finally {
                    setLoading(false);
                }
            }
        };

        fetchMultiSigData();
    }, [invoice?.invoice_id, status]);

    const handleApprove = async () => {
        if (!invoice?.invoice_id) return;

        try {
            setApproving(true);
            const response = await approveMultiSig(invoice.invoice_id);
            
            if (response.data.success) {
                toast.success('Approval submitted successfully!');
                
                // Update local state
                setMultiSigData(prev => ({
                    ...prev,
                    approvalCount: response.data.approvalCount,
                    isFullyApproved: response.data.isFullyApproved,
                    approvers: [...(prev?.approvers || []), response.data.approver]
                }));

                // If fully approved, trigger release
                if (response.data.isFullyApproved && onConfirm) {
                    toast.info('Multi-signature threshold reached! Funds will be released.');
                    onConfirm(invoice);
                }
            }
        } catch (error) {
            console.error('Error approving:', error);
            toast.error(error.response?.data?.message || 'Failed to submit approval');
        } finally {
            setApproving(false);
        }
    };

    // Check if current user can approve (is buyer or seller)
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const isAuthorizedApprover = user?.wallet_address && 
        multiSigData && 
        (multiSigData.sellerAddress === user.wallet_address.toLowerCase() || 
         multiSigData.buyerAddress === user.wallet_address.toLowerCase());
    
    const hasUserApproved = multiSigData?.currentUserApproved || false;
    const canShowApproveButton = isAuthorizedApprover && 
        !hasUserApproved && 
        (status === 'deposited' || status === 'funded') &&
        multiSigData?.required > 0;

    // Updated status configurations
    const statusConfig = {
        deposited: {
            label: 'Funds in Escrow',
            color: 'text-blue-600 bg-blue-100',
            action: 'Funds are held securely. Waiting for the seller to confirm shipment.'
        },
        funded: {
            label: 'Funds in Escrow',
            color: 'text-blue-600 bg-blue-100',
            action: 'Funds are held securely. Waiting for approval to release.'
        },
        shipped: {
            label: 'Shipped',
            color: 'text-purple-600 bg-purple-100',
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

            {/* Multi-Signature Approval Section */}
            {multiSigData && (status === 'deposited' || status === 'funded') && (
                <div className="mb-4 p-3 bg-gray-50 rounded-md">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="text-sm font-semibold text-gray-700">Multi-Signature Approval</h4>
                        <span className="text-sm text-gray-600">
                            {multiSigData.approvalCount || 0} / {multiSigData.required || 2}
                        </span>
                    </div>
                    
                    {/* Progress bar */}
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                        <div 
                            className={`h-2 rounded-full ${multiSigData.isFullyApproved ? 'bg-green-600' : 'bg-blue-600'}`}
                            style={{ width: `${Math.min(((multiSigData.approvalCount || 0) / (multiSigData.required || 2)) * 100, 100)}%` }}
                        ></div>
                    </div>

                    {/* Approvers list */}
                    {multiSigData.approvers && multiSigData.approvers.length > 0 && (
                        <div className="mb-3">
                            <p className="text-xs text-gray-500 mb-1">Approved by:</p>
                            <div className="flex flex-wrap gap-1">
                                {multiSigData.approvers.map((approver, index) => (
                                    <span key={index} className="inline-flex items-center px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                                        </svg>
                                        {approver.slice(0, 6)}...{approver.slice(-4)}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Current user status */}
                    {isAuthorizedApprover && (
                        <div className="mt-2">
                            {hasUserApproved ? (
                                <div className="flex items-center text-green-600 text-sm">
                                    <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                                    </svg>
                                    You have approved this escrow
                                </div>
                            ) : (
                                <button
                                    onClick={handleApprove}
                                    disabled={approving || multiSigData.isFullyApproved}
                                    className={`w-full py-2 px-4 rounded-md text-white font-medium transition-colors ${
                                        multiSigData.isFullyApproved 
                                            ? 'bg-gray-400 cursor-not-allowed'
                                            : 'bg-blue-600 hover:bg-blue-700'
                                    }`}
                                >
                                    {approving ? 'Submitting...' : 'Approve Release'}
                                </button>
                            )}
                        </div>
                    )}

                    {loading && (
                        <div className="text-center py-2 text-gray-500 text-sm">
                            Loading approval status...
                        </div>
                    )}

                    {multiSigData.isFullyApproved && (
                        <div className="mt-2 p-2 bg-green-100 text-green-800 text-sm rounded text-center">
                            ✓ All approvals received - Funds will be released
                        </div>
                    )}
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                {/* The 'Confirm & Release' button appears when status is 'shipped' */}
                {status === 'shipped' && onConfirm && (
                    <button
                        onClick={() => onConfirm(invoice)}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md w-full sm:w-auto"
                    >
                        Confirm & Release Funds
                    </button>
                )}
                
                {/* Allow dispute during 'deposited' and 'shipped' states */}
                {(status === 'deposited' || status === 'shipped' || status === 'funded') && onDispute && (
                    <button
                        onClick={() => {
                            const reason = prompt('Please enter the reason for the dispute:');
                            if (reason) onDispute(invoice, reason);
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md w-full sm:w-auto"
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
