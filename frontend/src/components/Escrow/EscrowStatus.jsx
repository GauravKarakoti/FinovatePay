import React, { useState, useEffect } from 'react';
import { getMultiSigApprovals, approveMultiSig, createMultiPartyEscrow, getEscrowStatus } from '../../utils/api';
import { toast } from 'sonner';

const EscrowStatus = ({ invoice, onConfirm, onDispute }) => {
    const [multiSigData, setMultiSigData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [approving, setApproving] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [creatingEscrow, setCreatingEscrow] = useState(false);
    const [durationSeconds, setDurationSeconds] = useState(7 * 24 * 60 * 60);

    const status = invoice?.escrow_status;

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

    // Gracefully handle the case where no invoice is selected
    if (!invoice) {
        return (
            <div className="bg-white rounded-lg shadow-md p-4 h-full flex items-center justify-center">
                <p className="text-gray-500 text-center">Select an invoice to see its escrow details.</p>
            </div>
        );
    }

    const handleApprove = async () => {
        if (!invoice?.invoice_id) return;

        try {
            setApproving(true);
            const response = await approveMultiSig(invoice.invoice_id);
            toast.success(response.message || 'Approval submitted successfully');

            // Refresh multi-sig data
            const updatedData = await getMultiSigApprovals(invoice.invoice_id);
            setMultiSigData(updatedData.data);
        } catch (error) {
            console.error('Error approving multi-sig:', error);
            toast.error(error.response?.data?.error || 'Failed to submit approval');
        } finally {
            setApproving(false);
        }
    };

    const canShowApproveButton = multiSigData &&
        (status === 'deposited' || status === 'funded') &&
        !multiSigData.hasApproved &&
        multiSigData.currentApprovals < multiSigData.requiredApprovals;

    return (
        <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold mb-4">Escrow Status</h3>

            <div className="space-y-4">
                <div>
                    <span className="text-gray-600">Status:</span>
                    <span className={`ml-2 px-3 py-1 rounded-full text-sm font-medium ${
                        status === 'released' ? 'bg-green-100 text-green-800' :
                        status === 'disputed' ? 'bg-red-100 text-red-800' :
                        status === 'deposited' || status === 'funded' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                    }`}>
                        {status}
                    </span>
                </div>

                {loading && (
                    <div className="text-gray-500">Loading multi-sig data...</div>
                )}

                {multiSigData && (status === 'deposited' || status === 'funded') && (
                    <div className="border-t pt-4">
                        <h4 className="font-semibold mb-2">Multi-Signature Approval</h4>
                        <div className="space-y-2">
                            <div>
                                <span className="text-gray-600">Required Approvals:</span>
                                <span className="ml-2 font-medium">{multiSigData.requiredApprovals}</span>
                            </div>
                            <div>
                                <span className="text-gray-600">Current Approvals:</span>
                                <span className="ml-2 font-medium">{multiSigData.currentApprovals}</span>
                            </div>
                            <div>
                                <span className="text-gray-600">Your Status:</span>
                                <span className={`ml-2 px-2 py-1 rounded text-sm ${
                                    multiSigData.hasApproved ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                }`}>
                                    {multiSigData.hasApproved ? 'Approved' : 'Pending'}
                                </span>
                            </div>
                        </div>

                        {canShowApproveButton && (
                            <button
                                onClick={handleApprove}
                                disabled={approving}
                                className="mt-4 w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                            >
                                {approving ? 'Submitting...' : 'Approve Release'}
                            </button>
                        )}
                    </div>
                )}

                {/* Create Multi-Party Escrow Modal trigger - visible when invoice is in 'created' state */}
                {status === 'created' && (
                    <div className="mt-4">
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                            Create Multi-Party Escrow
                        </button>
                    </div>
                )}

                {/* Modal */}
                {showCreateModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg p-6 w-full max-w-md">
                            <h4 className="text-lg font-semibold mb-3">Create Multi-Party Escrow</h4>
                            <label className="block text-sm text-gray-600">Duration (seconds)</label>
                            <input
                                type="number"
                                value={durationSeconds}
                                onChange={(e) => setDurationSeconds(Number(e.target.value))}
                                className="w-full border rounded p-2 mt-1"
                            />
                            <div className="flex gap-2 mt-4">
                                <button
                                    onClick={async () => {
                                        try {
                                            setCreatingEscrow(true);
                                            const resp = await createMultiPartyEscrow(invoice.invoice_id, durationSeconds);
                                            toast.success(resp.data?.message || 'Multi-party escrow created');

                                            // Refresh escrow status and multi-sig data
                                            const statusResp = await getEscrowStatus(invoice.invoice_id);
                                            setMultiSigData(statusResp.data?.approvals || null);
                                            setShowCreateModal(false);
                                        } catch (err) {
                                            console.error('Create escrow failed', err);
                                            toast.error(err.response?.data?.error || 'Failed to create escrow');
                                        } finally {
                                            setCreatingEscrow(false);
                                        }
                                    }}
                                    disabled={creatingEscrow}
                                    className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-300"
                                >
                                    {creatingEscrow ? 'Creating...' : 'Create'}
                                </button>
                                <button
                                    onClick={() => setShowCreateModal(false)}
                                    className="flex-1 bg-gray-200 text-gray-800 py-2 px-4 rounded-lg hover:bg-gray-300"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {status === 'deposited' || status === 'funded' ? (
                    <div className="flex gap-2 mt-4">
                        <button
                            onClick={onConfirm}
                            className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-colors"
                        >
                            Confirm Release
                        </button>
                        <button
                            onClick={onDispute}
                            className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 transition-colors"
                        >
                            Raise Dispute
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export default EscrowStatus;
