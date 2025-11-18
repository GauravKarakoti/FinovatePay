import { useState, useEffect } from 'react';
import { approveFinancingManager, checkFinancingManagerApproval } from '../../utils/web3';
import { toast } from 'react-hot-toast';

const FinancingTab = ({ invoices, onTokenizeClick }) => {
    const [isFinancingApproved, setIsFinancingApproved] = useState(false);
    const [isApprovalLoading, setIsApprovalLoading] = useState(false);
    const [isCheckingApproval, setIsCheckingApproval] = useState(true);

    useEffect(() => {
        const checkApproval = async () => {
        try {
            setIsCheckingApproval(true);
            const approved = await checkFinancingManagerApproval();
            setIsFinancingApproved(approved);
        } catch (err) {
            console.error("Failed to check approval", err);
            toast.error("Failed to check financing approval status.");
        } finally {
            setIsCheckingApproval(false);
        }
        };
        checkApproval();
    }, []);

    // Invoices eligible for tokenization (must be deposited, not yet tokenized)
    const eligibleInvoices = invoices.filter(
        inv => inv.escrow_status === 'deposited' && !inv.is_tokenized
    );

    // Invoices already tokenized and listed
    const listedInvoices = invoices.filter(
        inv => inv.is_tokenized && inv.financing_status === 'listed'
    );

    const handleEnableFinancing = async () => {
        setIsApprovalLoading(true);
        toast.loading("Waiting for approval transaction...");
        try {
            await approveFinancingManager();
            toast.dismiss();
            toast.success("Automated financing enabled!");
            setIsFinancingApproved(true);
        } catch (err) {
            toast.dismiss();
            toast.error("Transaction failed or rejected.");
            console.error(err);
        } finally {
            setIsApprovalLoading(false);
        }
    };

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Invoice Financing</h2>
            
            <div className="mb-6 p-4 bg-gray-50 rounded-lg shadow-sm">
                <h3 className="text-lg font-semibold">Automated Financing Marketplace</h3>
                <p className="text-sm text-gray-600 mb-3">
                    To sell your invoice fractions on the marketplace, you must first grant one-time approval for the Financing Manager contract to handle your tokens.
                </p>
                <button
                    onClick={handleEnableFinancing}
                    disabled={isFinancingApproved || isApprovalLoading || isCheckingApproval}
                    className={`px-4 py-2 rounded-md text-white ${
                        isFinancingApproved
                        ? 'bg-green-600 cursor-not-allowed'
                        : isApprovalLoading || isCheckingApproval
                        ? 'bg-gray-400 cursor-wait'
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                >
                    {isFinancingApproved
                        ? '✓ Financing Enabled'
                        : isApprovalLoading
                        ? 'Approving...'
                        : isCheckingApproval
                        ? 'Checking Status...'
                        : 'Enable Automated Financing'}
                </button>
            </div>
            <div className="bg-white shadow rounded-lg p-6 mb-8">
                <h3 className="text-xl font-semibold mb-4">Eligible to Tokenize</h3>
                <div className="space-y-4">
                    {eligibleInvoices.length > 0 ? (
                        eligibleInvoices.map(invoice => (
                            <div key={invoice.invoice_id} className="flex justify-between items-center p-4 border rounded-md">
                                <div>
                                    <p className="font-semibold">Invoice {invoice.invoice_id.substring(0, 8)}...</p>
                                    <p className="text-sm text-gray-600">Amount: {invoice.amount} {invoice.currency}</p>
                                    <p className="text-sm text-gray-600">Status: <span className="font-medium text-green-600">Deposited in Escrow</span></p>
                                </div>
                                <button
                                    onClick={() => onTokenizeClick(invoice)}
                                    className="btn-primary"
                                >
                                    Tokenize
                                </button>
                            </div>
                        ))
                    ) : (
                        <p className="text-gray-500">No invoices are currently eligible for tokenization. An invoice must be deposited by the buyer in escrow first.</p>
                    )}
                </div>
            </div>

            {/* Section 2: Listed on Marketplace */}
            <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-xl font-semibold mb-4">Listed on Marketplace</h3>
                <div className="space-y-4">
                    {listedInvoices.length > 0 ? (
                        listedInvoices.map(invoice => (
                            <div key={invoice.invoice_id} className="flex justify-between items-center p-4 border rounded-md bg-gray-50">
                                <div>
                                    <p className="font-semibold">Invoice {invoice.invoice_id.substring(0, 8)}...</p>
                                    <p className="text-sm text-gray-600">Face Value: {invoice.face_value} {invoice.currency}</p>
                                    <p className="text-sm text-gray-600">Token ID: {invoice.token_id}</p>
                                </div>
                                <span className="text-sm font-medium text-blue-600 px-3 py-1 bg-blue-100 rounded-full">
                                    Listed
                                </span>
                            </div>
                        ))
                    ) : (
                        <p className="text-gray-500">You have no invoices currently listed on the marketplace.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FinancingTab;