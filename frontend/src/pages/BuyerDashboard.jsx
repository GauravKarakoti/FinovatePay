import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import {
    getBuyerInvoices,
    updateInvoiceStatus,
    getAvailableLots,
    createQuotation,
    getPendingBuyerApprovals, // <-- Use the new specific API call
    buyerApproveQuotation,
    rejectQuotation,
    getKYCStatus
} from '../utils/api';
import { connectWallet, erc20ABI } from '../utils/web3';
import StatsCard from '../components/Dashboard/StatsCard';
import InvoiceList from '../components/Invoice/InvoiceList';
import EscrowStatus from '../components/Escrow/EscrowStatus';
import EscrowTimeline from '../components/Escrow/EscrowTimeline';
import KYCStatus from '../components/KYC/KYCStatus';
import InvoiceContractABI from '../../../deployed/Invoice.json';
import { generateTimelineEvents } from '../utils/timeline';
import { toast } from 'sonner';
import PaymentHistoryList from '../components/Dashboard/PaymentHistoryList';
import BuyerQuotationApproval from '../components/Quotation/BuyerQuotationApproval';
import AmountDisplay from '../components/common/AmountDisplay';
import ProduceQRCode from '../components/Produce/ProduceQRCode';
import KYCVerification from '../components/KYC/KYCVerification';

const BuyerDashboard = ({ activeTab }) => {
    const [invoices, setInvoices] = useState([]);
    const [availableLots, setAvailableLots] = useState([]);
    const [pendingApprovals, setPendingApprovals] = useState([]); // <-- Renamed state for clarity
    const [walletAddress, setWalletAddress] = useState('');
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [timelineEvents, setTimelineEvents] = useState([]);
    const [kycStatus, setKycStatus] = useState('not_started');
    const [kycRiskLevel, setKycRiskLevel] = useState('unknown');
    const [kycDetails, setKycDetails] = useState('');
    const [loadingInvoice, setLoadingInvoice] = useState(null);
    const [showQRCode, setShowQRCode] = useState(false);
    const [selectedLot, setSelectedLot] = useState(null);
    const [showKYCVerification, setShowKYCVerification] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            try {
                const { address } = await connectWallet();
                setWalletAddress(address);

                await loadKYCStatus();

                if (activeTab === 'produce') await loadAvailableLots();
                else if (activeTab === 'quotations') await loadPendingApprovals(); // Changed this tab name to 'quotations' for consistency, but its purpose is approvals.
                else await loadInvoices();

            } catch (error) {
                console.error('Failed to load initial data:', error);
                toast.error("Failed to load dashboard data.");
            }
        };
        loadData();
    }, [activeTab]);

    const loadKYCStatus = async () => {
        try {
            const response = await getKYCStatus();
            const data = response.data;
            
            // The backend returns { status: '...', kyc_risk_level: '...', details: '...' }
            // If the user hasn't started, it returns { status: 'not_started' }
            setKycStatus(data.status || 'not_started');
            setKycRiskLevel(data.kyc_risk_level || 'unknown');
            setKycDetails(data.details || (data.status === 'verified' ? 'Identity verified successfully' : 'Verification pending or not initiated'));
            
        } catch (error) {
            console.error('Failed to load KYC status:', error);
            // Don't show toast error here to avoid annoyance if it's just a 404/not found
        }
    };

    const handleKYCVerificationComplete = (result) => {
        setShowKYCVerification(false);
        loadKYCStatus(); // Refresh status
        result.verified ? toast.success('Verified!') : toast.error("Verification failed.");
    };

    const loadInvoices = async () => {
        try {
            const invoicesData = await getBuyerInvoices();
            setInvoices(invoicesData.data);
        } catch (error) {
            console.error('Failed to load invoices:', error);
            toast.error("Could not load your invoices.");
        }
    };
    
    const loadAvailableLots = async () => {
        try {
            const lotsData = await getAvailableLots();
            setAvailableLots(lotsData.data);
        } catch (error) {
            console.error('Failed to load available lots:', error);
            toast.error("Could not load the produce marketplace.");
        }
    };

    const loadPendingApprovals = async () => {
        try {
            const response = await getPendingBuyerApprovals();
            setPendingApprovals(response.data);
        } catch (error) {
            console.error('Failed to load pending approvals:', error);
            toast.error("Could not load pending approvals.");
        }
    };

    const handleApproveQuotation = async (quotationId) => {
        try {
            await buyerApproveQuotation(quotationId);
            toast.success('Quotation approved! The seller can now create an invoice.');
            await loadPendingApprovals(); 
        } catch (error) {
            toast.error('Failed to approve quotation: ' + (error.response?.data?.error || error.message));
        }
    };

    const handleRejectQuotation = async (quotationId) => {
        try {
            await rejectQuotation(quotationId);
            toast.info("Quotation rejected.");
            await loadPendingApprovals(); 
        } catch (error) {
            toast.error("Failed to reject quotation: " + (error.response?.data?.error || error.message));
        }
    };

    const handleRequestToBuy = async (lot) => {
        const quantity = prompt(`How much "${lot.produce_type}" do you want to request? (Available: ${lot.current_quantity} kg)`);
        if (!quantity || isNaN(quantity) || parseFloat(quantity) <= 0) {
            toast.error("Please enter a valid quantity.");
            return;
        }
        if (parseFloat(quantity) > parseFloat(lot.current_quantity)) {
            toast.error("Requested quantity exceeds available stock.");
            return;
        }

        try {
            const quotationData = {
                lot_id: lot.lot_id,
                seller_address: lot.farmer_address,
                quantity: parseFloat(quantity),
                price_per_unit: lot.price / 50.75,
                description: `${quantity}kg of ${lot.produce_type} from lot #${lot.lot_id}`
            };
            await createQuotation(quotationData);
            toast.success("Quotation request sent to the seller!");
        } catch (error) {
            console.error("Failed to create quotation:", error);
            toast.error("Failed to send quotation request.");
        }
    };

    const handlePayInvoice = async (invoice) => {
        if (!invoice || !ethers.utils.isAddress(invoice.contract_address)) {
            toast.error(`Error: Invalid or missing contract address for this invoice.`);
            return;
        }

        setLoadingInvoice(invoice.invoice_id);
        const paymentPromise = async () => {
            const { signer } = await connectWallet();
            const { amount, currency, contract_address, token_address } = invoice;
            
            const invoiceContract = new ethers.Contract(contract_address, InvoiceContractABI.abi, signer);
            const amountWei = ethers.utils.parseUnits(amount.toString(), 18);
            console.log("Depositing to escrow:", { invoiceId: invoice.invoice_id, amount: amountWei.toString(), seller_address: invoice.seller_address });
            let tx;

            if (currency === 'MATIC') {
                tx = await invoiceContract.depositNative({ value: amountWei });
            } else {
                const tokenContract = new ethers.Contract(token_address, erc20ABI, signer);
                toast.info('Requesting token approval from your wallet...');
                const approveTx = await tokenContract.approve(contract_address, amountWei);
                await approveTx.wait();
                toast.success('Approval successful! Now confirming deposit...');
                tx = await invoiceContract.depositToken();
            }
            
            await tx.wait();
            await updateInvoiceStatus(invoice.invoice_id, 'deposited', tx.hash);
            return tx.hash;
        };

        try {
            await toast.promise(paymentPromise(), {
                loading: 'Processing payment deposit...',
                success: (txHash) => {
                    loadInvoices();
                    return `Payment deposited successfully! Tx: ${txHash.substring(0, 10)}...`;
                },
                error: (err) => `Payment failed: ${err.reason || err.message}`
            });
        } catch (error) {
            console.error('Payment process failed:', error);
        } finally {
            setLoadingInvoice(null);
        }
    };

    const handleReleaseFunds = async (invoice) => {
        if (!window.confirm("Are you sure you want to release the funds to the seller? This action is irreversible.")) {
            return;
        }
        setLoadingInvoice(invoice.invoice_id);
        try {
            const { signer } = await connectWallet();
            const invoiceContract = new ethers.Contract(invoice.contract_address, InvoiceContractABI.abi, signer);
            const tx = await invoiceContract.releaseFunds();
            await tx.wait();
            toast.success(`Funds released! Tx: ${tx.hash}`);
            await updateInvoiceStatus(invoice.invoice_id, 'released', tx.hash);
            loadInvoices();
        } catch (error) {
            console.error('Failed to release funds:', error);
            toast.error(`Release failed: ${error.reason || error.message}`);
        } finally {
            setLoadingInvoice(null);
        }
    };

    const handleRaiseDispute = async (invoice) => {
        const reason = prompt('Please enter the reason for the dispute:');
        if (!reason) return;

        setLoadingInvoice(invoice.invoice_id);
        try {
            const { signer } = await connectWallet();
            const invoiceContract = new ethers.Contract(invoice.contract_address, InvoiceContractABI.abi, signer);
            const tx = await invoiceContract.raiseDispute();
            await tx.wait();
            toast.success(`Dispute raised! Tx: ${tx.hash}`);
            await updateInvoiceStatus(invoice.invoice_id, 'disputed', tx.hash, reason);
            loadInvoices();
        } catch (error) {
            console.error('Failed to raise dispute:', error);
            toast.error(`Dispute failed: ${error.reason || error.message}`);
        } finally {
            setLoadingInvoice(null);
        }
    };

    const handleSelectInvoice = (invoice) => {
        setSelectedInvoice(invoice);
        setTimelineEvents(generateTimelineEvents(invoice));
    };

    const handleShowQRCode = (invoice) => {
        setSelectedLot({
            lotId: invoice.lot_id,
            produceType: invoice.produce_type,
            origin: invoice.origin,
        });
        setShowQRCode(true);
    };

    const escrowInvoices = invoices.filter(inv => ['deposited', 'disputed', 'shipped'].includes(inv.escrow_status));
    const completedInvoices = invoices.filter(inv => inv.escrow_status === 'released');
    const stats = [
        { title: 'Pending Invoices', value: invoices.filter(i => i.escrow_status === 'created').length, icon: '📝', color: 'blue' },
        { title: 'Active Escrows', value: escrowInvoices.length, icon: '🔒', color: 'green' },
        { title: 'Completed', value: invoices.filter(i => i.escrow_status === 'released').length, icon: '✅', color: 'purple' },
        { title: 'Disputed', value: invoices.filter(i => i.escrow_status === 'disputed').length, icon: '⚖️', color: 'red' },
    ];

    const renderTabContent = () => {
        switch (activeTab) {
            case 'quotations':
                return (
                    <div>
                        <h2 className="text-2xl font-bold mb-6">Pending Approvals</h2>
                        <BuyerQuotationApproval 
                            quotations={pendingApprovals} 
                            onApprove={handleApproveQuotation}
                            onReject={handleRejectQuotation}
                        />
                    </div>
                );

            case 'overview':
                return (
                    <div>
                        <h2 className="text-2xl font-bold mb-6">Overview</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                            {stats.map((stat, index) => (
                                <StatsCard key={index} {...stat} />
                            ))}
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div>
                                <h3 className="text-xl font-semibold mb-4">Recent Invoices</h3>
                                <InvoiceList
                                    invoices={invoices.slice(0, 5)}
                                    userRole="buyer"
                                    onSelectInvoice={handleSelectInvoice}
                                    onPayInvoice={handlePayInvoice}
                                    onConfirmRelease={handleReleaseFunds}
                                    onRaiseDispute={handleRaiseDispute}
                                    onShowQRCode={handleShowQRCode}
                                />
                            </div>
                            <div>
                                <h3 className="text-xl font-semibold mb-4">KYC Status</h3>
                                {/* [UPDATED] Pass dynamic data to the KYC Status component */}
                                <KYCStatus
                                    status={kycStatus}
                                    riskLevel={kycRiskLevel}
                                    details={kycDetails}
                                    onReverify={() => setShowKYCVerification(true)}
                                />
                            </div>
                        </div>
                    </div>
                );
            case 'invoices':
                return (
                    <div>
                        <h2 className="text-2xl font-bold mb-6">Your Invoices</h2>
                        <InvoiceList
                            invoices={invoices}
                            userRole="buyer"
                            onSelectInvoice={handleSelectInvoice}
                            onPayInvoice={handlePayInvoice}
                            onConfirmRelease={handleReleaseFunds}
                            onRaiseDispute={handleRaiseDispute}
                            onShowQRCode={handleShowQRCode}
                        />
                    </div>
                );
            case 'payments':
                return (
                    <div>
                        <h2 className="text-2xl font-bold mb-6">Payment History</h2>
                        <PaymentHistoryList invoices={completedInvoices} userRole="buyer" />
                    </div>
                );
            case 'escrow':
                return (
                    <div>
                        <h2 className="text-2xl font-bold mb-6">Escrow Management</h2>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <EscrowStatus
                                invoice={selectedInvoice}
                                onConfirm={handleReleaseFunds}
                                onDispute={handleRaiseDispute}
                            />
                            <EscrowTimeline events={timelineEvents} />
                        </div>
                        <div className="mt-6">
                            <h3 className="text-xl font-semibold mb-4">Invoices in Escrow</h3>
                            <InvoiceList
                                invoices={escrowInvoices}
                                userRole="buyer"
                                onSelectInvoice={handleSelectInvoice}
                                onConfirmRelease={handleReleaseFunds}
                                onRaiseDispute={handleRaiseDispute}
                            />
                        </div>
                    </div>
                );
            case 'produce':
                return (
                    <div>
                        <h2 className="text-2xl font-bold mb-6">Produce Marketplace</h2>
                        <div className="bg-white rounded-lg shadow-md overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Produce</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Farmer</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Origin</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Available</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Price / kg</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {availableLots.map((lot) => (
                                            <tr key={lot.lot_id}>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{lot.produce_type}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500" title={lot.farmer_address}>{lot.farmer_name || ethers.utils.getAddress(lot.farmer_address).slice(0,6)}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{lot.origin}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{lot.current_quantity} kg</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                    <AmountDisplay maticAmount={lot.price / 50.75} />
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                    <button
                                                        onClick={() => handleRequestToBuy(lot)}
                                                        className="text-white bg-green-600 hover:bg-green-700 px-3 py-1 rounded-md text-xs"
                                                    >
                                                        Request Quotation
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {availableLots.length === 0 && (
                                <div className="text-center py-12 text-gray-500">
                                    <p>No produce is currently available in the marketplace.</p>
                                </div>
                            )}
                        </div>
                    </div>
                );
            default:
                return (
                    <div>
                        <h2 className="text-2xl font-bold mb-6">Dashboard</h2>
                        <div className="bg-white rounded-lg shadow-md p-6">
                            <p className="text-gray-600">Select a section from the sidebar to get started.</p>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="container mx-auto p-4">
            {renderTabContent()}

            {showQRCode && selectedLot && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white p-6 rounded-lg shadow-xl">
                        <ProduceQRCode
                            lotId={selectedLot.lotId}
                            produceType={selectedLot.produceType}
                            origin={selectedLot.origin}
                        />
                        <button
                            onClick={() => setShowQRCode(false)}
                            className="mt-4 w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BuyerDashboard;