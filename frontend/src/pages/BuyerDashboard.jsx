import { useState, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { ethers } from 'ethers';
import {
  getBuyerInvoices,
  updateInvoiceStatus,
  getAvailableLots,
  createQuotation,
  getPendingBuyerApprovals,
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
import { useStatsActions } from '../context/StatsContext';

// Loading Spinner Component
const LoadingSpinner = () => (
  <div className="flex items-center justify-center py-12">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" role="status">
      <span className="sr-only">Loading...</span>
    </div>
  </div>
);

// Empty State Component
const EmptyState = ({ message = "No data available", icon = "📭" }) => (
  <div className="text-center py-12 px-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
    <div className="text-4xl mb-2">{icon}</div>
    <p className="text-gray-500 font-medium">{message}</p>
  </div>
);

EmptyState.propTypes = {
  message: PropTypes.string,
  icon: PropTypes.string
};

// Action Button Component
const ActionButton = ({ 
  onClick, 
  children, 
  variant = 'primary', 
  disabled = false, 
  loading = false,
  className = '' 
}) => {
  const baseClasses = "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    success: "bg-green-600 text-white hover:bg-green-700 shadow-sm",
    danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
    secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200",
    outline: "border-2 border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50"
  };
  
  return (
    <button 
      onClick={onClick} 
      disabled={disabled || loading}
      className={`${baseClasses} ${variants[variant]} ${className}`}
    >
      {loading && <span className="animate-spin">⏳</span>}
      {children}
    </button>
  );
};

ActionButton.propTypes = {
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(['primary', 'success', 'danger', 'secondary', 'outline']),
  disabled: PropTypes.bool,
  loading: PropTypes.bool,
  className: PropTypes.string
};

// Modal Component for QR Code
const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-fadeIn">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
};

Modal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string,
  children: PropTypes.node
};

const BuyerDashboard = ({ activeTab = 'overview' }) => {
  // State Management
  const [invoices, setInvoices] = useState([]);
  const [availableLots, setAvailableLots] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [walletAddress, setWalletAddress] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [kycData, setKycData] = useState({
    status: 'not_started',
    riskLevel: 'unknown',
    details: 'Verification pending or not initiated'
  });
  
  // UI State
  const [isLoading, setIsLoading] = useState(true);
  const [loadingInvoiceId, setLoadingInvoiceId] = useState(null);
  const [processingLotId, setProcessingLotId] = useState(null);
  const [showQRCode, setShowQRCode] = useState(false);
  const [selectedLot, setSelectedLot] = useState(null);
  const [showKYCVerification, setShowKYCVerification] = useState(false);
  const { setStats: setGlobalStats } = useStatsActions();

  // Load Initial Data
  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { address } = await connectWallet();
      setWalletAddress(address);
      
      // Load KYC status in parallel with tab-specific data
      const kycPromise = loadKYCStatus();
      
      await Promise.all([
        kycPromise,
        loadTabData(activeTab)
      ]);
    } catch (error) {
      console.error('Failed to load initial data:', error);
      toast.error("Please connect your wallet to access the dashboard");
    } finally {
      setIsLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    const init = async () => {
      if (!walletAddress) {
        await loadInitialData();
      } else {
        await loadTabData(activeTab);
      }
    };
    init();
  }, [activeTab, walletAddress, loadInitialData]);

  const loadTabData = async (tab) => {
    switch (tab) {
      case 'produce':
        await loadAvailableLots();
        break;
      case 'quotations':
        await loadPendingApprovals();
        break;
      case 'overview':
      case 'invoices':
      case 'escrow':
      case 'payments':
        await loadInvoices();
        break;
      default:
        break;
    }
  };

  const loadKYCStatus = async () => {
    try {
      const { data } = await getKYCStatus();
      setKycData({
        status: data.status || 'not_started',
        riskLevel: data.kyc_risk_level || 'unknown',
        details: data.details || (data.status === 'verified' ? 'Identity verified successfully' : 'Verification pending')
      });
    } catch (error) {
      console.error('Failed to load KYC status:', error);
      // Silent fail - user might not have started KYC yet
    }
  };

  const loadInvoices = async () => {
    try {
      const { data } = await getBuyerInvoices();
      setInvoices(data || []);
    } catch (error) {
      console.error('Failed to load invoices:', error);
      toast.error("Could not load your invoices");
    }
  };

  const loadAvailableLots = async () => {
    try {
      const { data } = await getAvailableLots();
      setAvailableLots(data || []);
    } catch (error) {
      console.error('Failed to load lots:', error);
      toast.error("Could not load marketplace");
    }
  };

  const loadPendingApprovals = async () => {
    try {
      const { data } = await getPendingBuyerApprovals();
      setPendingApprovals(data || []);
    } catch (error) {
      console.error('Failed to load approvals:', error);
      toast.error("Could not load pending approvals");
    }
  };

  // Memoized Calculations
  const { escrowInvoices, completedInvoices, stats } = useMemo(() => {
    const escrow = invoices.filter(inv => ['deposited', 'disputed', 'shipped'].includes(inv.escrow_status));
    const completed = invoices.filter(inv => inv.escrow_status === 'released');
    
    const statsData = [
      { 
        title: 'Pending', 
        value: invoices.filter(i => i.escrow_status === 'created').length, 
        icon: '📝', 
        color: 'blue',
        description: 'Awaiting payment'
      },
      { 
        title: 'Active Escrows', 
        value: escrow.length, 
        icon: '🔒', 
        color: 'green',
        description: 'In progress'
      },
      { 
        title: 'Completed', 
        value: completed.length, 
        icon: '✅', 
        color: 'purple',
        description: 'Successfully delivered'
      },
      { 
        title: 'Disputed', 
        value: invoices.filter(i => i.escrow_status === 'disputed').length, 
        icon: '⚖️', 
        color: 'red',
        description: 'Requires resolution'
      },
    ];
    
    return { escrowInvoices: escrow, completedInvoices: completed, stats: statsData };
  }, [invoices]);

  useEffect(() => {
    const nextStats = {
      totalInvoices: invoices.length,
      activeEscrows: escrowInvoices.length,
      completed: completedInvoices.length,
      produceLots: availableLots.length
    };

    // Only update if data is loaded and actually different
    if (!isLoading) {
      setGlobalStats(nextStats);
    }
  }, [invoices.length, escrowInvoices.length, completedInvoices.length, availableLots.length, isLoading, setGlobalStats]);

  // Handlers
  const handleKYCComplete = useCallback((result) => {
    setShowKYCVerification(false);
    loadKYCStatus();
    toast[result.verified ? 'success' : 'error'](
      result.verified ? 'Identity verified successfully!' : 'Verification failed or cancelled'
    );
  }, []);

  const handleApproveQuotation = useCallback(async (quotationId) => {
    try {
      await buyerApproveQuotation(quotationId);
      toast.success('Quotation approved! Seller can now create an invoice.');
      await loadPendingApprovals();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to approve quotation');
    }
  }, []);

  const handleRejectQuotation = useCallback(async (quotationId) => {
    try {
      await rejectQuotation(quotationId);
      toast.info("Quotation rejected");
      await loadPendingApprovals();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to reject quotation');
    }
  }, []);

  const handleRequestToBuy = useCallback(async (lot) => {
    const quantity = prompt(`Enter quantity for ${lot.produce_type} (Available: ${lot.current_quantity}kg):`);
    const parsedQty = parseFloat(quantity);

    if (!quantity || isNaN(parsedQty) || parsedQty <= 0) {
      toast.error("Please enter a valid quantity");
      return;
    }
    if (parsedQty > parseFloat(lot.current_quantity)) {
      toast.error("Quantity exceeds available stock");
      return;
    }

    setProcessingLotId(lot.lot_id);
    try {
      await createQuotation({
        lot_id: lot.lot_id,
        seller_address: lot.farmer_address,
        quantity: parsedQty,
        price_per_unit: lot.price / 50.75,
        description: `${parsedQty}kg of ${lot.produce_type} from lot #${lot.lot_id}`
      });
      toast.success("Quotation request sent to seller!");
    } catch (error) {
      console.error("Failed to create quotation:", error);
      toast.error("Failed to send request");
    } finally {
      setProcessingLotId(null);
    }
  }, []);

  const handlePayInvoice = useCallback(async (invoice) => {
    if (!ethers.isAddress(invoice.contract_address)) {
      toast.error('Invalid contract address');
      return;
    }

    setLoadingInvoiceId(invoice.invoice_id);
    const toastId = toast.loading('Processing payment...');

    try {
      const { signer } = await connectWallet();
      const { amount, currency, contract_address, token_address } = invoice;
      const amountWei = ethers.parseUnits(amount.toString(), 18);
      
      const invoiceContract = new ethers.Contract(contract_address, InvoiceContractABI.abi, signer);
      let tx;

      if (currency === 'MATIC') {
        tx = await invoiceContract.depositNative({ value: amountWei });
      } else {
        const tokenContract = new ethers.Contract(token_address, erc20ABI, signer);
        toast.loading('Approving tokens...', { id: toastId });
        
        const approveTx = await tokenContract.approve(contract_address, amountWei);
        await approveTx.wait();
        
        toast.loading('Confirming deposit...', { id: toastId });
        tx = await invoiceContract.depositToken();
      }
      
      await tx.wait();
      await updateInvoiceStatus(invoice.invoice_id, 'deposited', tx.hash);
      
      toast.success(`Payment successful! ${tx.hash.slice(0, 10)}...`, { id: toastId });
      await loadInvoices();
    } catch (error) {
      console.error('Payment failed:', error);
      toast.error(error.reason || error.message || 'Payment failed', { id: toastId });
    } finally {
      setLoadingInvoiceId(null);
    }
  }, []);

  const handleReleaseFunds = useCallback(async (invoice) => {
    if (!window.confirm("Release funds to seller? This cannot be undone.")) return;

    setLoadingInvoiceId(invoice.invoice_id);
    try {
      const { signer } = await connectWallet();
      const contract = new ethers.Contract(invoice.contract_address, InvoiceContractABI.abi, signer);
      const tx = await contract.releaseFunds();
      await tx.wait();
      
      await updateInvoiceStatus(invoice.invoice_id, 'released', tx.hash);
      toast.success(`Funds released! ${tx.hash.slice(0, 10)}...`);
      await loadInvoices();
    } catch (error) {
      toast.error(error.reason || 'Failed to release funds');
    } finally {
      setLoadingInvoiceId(null);
    }
  }, []);

  const handleRaiseDispute = useCallback(async (invoice) => {
    const reason = prompt('Enter reason for dispute:');
    if (!reason?.trim()) return;

    setLoadingInvoiceId(invoice.invoice_id);
    try {
      const { signer } = await connectWallet();
      const contract = new ethers.Contract(invoice.contract_address, InvoiceContractABI.abi, signer);
      const tx = await contract.raiseDispute();
      await tx.wait();
      
      await updateInvoiceStatus(invoice.invoice_id, 'disputed', tx.hash, reason);
      toast.success('Dispute raised successfully');
      await loadInvoices();
    } catch (error) {
      toast.error(error.reason || 'Failed to raise dispute');
    } finally {
      setLoadingInvoiceId(null);
    }
  }, []);

  const handleSelectInvoice = useCallback((invoice) => {
    setSelectedInvoice(invoice);
    setTimelineEvents(generateTimelineEvents(invoice));
  }, []);

  const handleShowQRCode = useCallback((invoice) => {
    setSelectedLot({
      lotId: invoice.lot_id,
      produceType: invoice.produce_type,
      origin: invoice.origin,
    });
    setShowQRCode(true);
  }, []);

  // Tab Components
  const QuotationsTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Pending Approvals</h2>
        <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
          {pendingApprovals.length} pending
        </span>
      </div>
      
      {pendingApprovals.length > 0 ? (
        <BuyerQuotationApproval 
          quotations={pendingApprovals} 
          onApprove={handleApproveQuotation}
          onReject={handleRejectQuotation}
        />
      ) : (
        <EmptyState message="No pending quotations to approve" icon="📋" />
      )}
    </div>
  );

  const OverviewTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <StatsCard key={`${stat.title}-${index}`} {...stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Recent Invoices</h3>
            </div>
            <div className="p-6">
              {invoices.length > 0 ? (
                <InvoiceList
                  invoices={invoices.slice(0, 5)}
                  userRole="buyer"
                  onSelectInvoice={handleSelectInvoice}
                  onPayInvoice={handlePayInvoice}
                  onConfirmRelease={handleReleaseFunds}
                  onRaiseDispute={handleRaiseDispute}
                  onShowQRCode={handleShowQRCode}
                  loadingId={loadingInvoiceId}
                />
              ) : (
                <EmptyState message="No invoices yet" />
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <KYCStatus
              status={kycData.status}
              riskLevel={kycData.riskLevel}
              details={kycData.details}
              onReverify={() => setShowKYCVerification(true)}
            />
          </div>
          
          <div className="bg-blue-50 rounded-xl p-6 border border-blue-100">
            <h4 className="font-semibold text-blue-900 mb-2">💡 Quick Tip</h4>
            <p className="text-sm text-blue-800">
              Always verify produce quality before releasing funds from escrow. Once released, transactions cannot be reversed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const InvoicesTab = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-900">Your Invoices</h2>
        <span className="text-sm text-gray-500">{invoices.length} total</span>
      </div>
      <div className="p-6">
        {invoices.length > 0 ? (
          <InvoiceList
            invoices={invoices}
            userRole="buyer"
            onSelectInvoice={handleSelectInvoice}
            onPayInvoice={handlePayInvoice}
            onConfirmRelease={handleReleaseFunds}
            onRaiseDispute={handleRaiseDispute}
            onShowQRCode={handleShowQRCode}
            loadingId={loadingInvoiceId}
          />
        ) : (
          <EmptyState message="No invoices found" />
        )}
      </div>
    </div>
  );

  const PaymentsTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Payment History</h2>
      {completedInvoices.length > 0 ? (
        <PaymentHistoryList invoices={completedInvoices} userRole="buyer" />
      ) : (
        <EmptyState message="No completed payments yet" icon="💳" />
      )}
    </div>
  );

  const EscrowTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Escrow Management</h2>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EscrowStatus
          invoice={selectedInvoice}
          onConfirm={handleReleaseFunds}
          onDispute={handleRaiseDispute}
        />
        <EscrowTimeline events={timelineEvents} />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Active Escrows</h3>
        </div>
        <div className="p-6">
          {escrowInvoices.length > 0 ? (
            <InvoiceList
              invoices={escrowInvoices}
              userRole="buyer"
              onSelectInvoice={handleSelectInvoice}
              onConfirmRelease={handleReleaseFunds}
              onRaiseDispute={handleRaiseDispute}
              loadingId={loadingInvoiceId}
            />
          ) : (
            <EmptyState message="No active escrows" icon="🔓" />
          )}
        </div>
      </div>
    </div>
  );

  const ProduceTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Produce Marketplace</h2>
        <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
          {availableLots.length} lots available
        </span>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Produce</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Farmer</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Origin</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price/kg</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {availableLots.map((lot) => (
                <tr key={lot.lot_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {lot.produce_type}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono" title={lot.farmer_address}>
                    {lot.farmer_name || `${lot.farmer_address.slice(0, 6)}...${lot.farmer_address.slice(-4)}`}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{lot.origin}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      {lot.current_quantity} kg
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    <AmountDisplay maticAmount={lot.price / 50.75} />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <ActionButton
                      onClick={() => handleRequestToBuy(lot)}
                      variant="success"
                      loading={processingLotId === lot.lot_id}
                      className="text-xs"
                    >
                      Request Quote
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {availableLots.length === 0 && (
          <EmptyState message="No produce available at the moment" icon="🌾" />
        )}
      </div>
    </div>
  );

  const renderContent = () => {
    if (isLoading) return <LoadingSpinner />;
    
    switch (activeTab) {
      case 'quotations': return <QuotationsTab />;
      case 'overview': return <OverviewTab />;
      case 'invoices': return <InvoicesTab />;
      case 'payments': return <PaymentsTab />;
      case 'escrow': return <EscrowTab />;
      case 'produce': return <ProduceTab />;
      default: return <OverviewTab />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Buyer Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500">
              Wallet: <span className="font-mono bg-gray-100 px-2 py-1 rounded">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span>
            </p>
          </div>
          {kycData.status !== 'verified' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 flex items-center gap-2">
              <span className="text-yellow-600">⚠️</span>
              <span className="text-sm text-yellow-800">Complete KYC to unlock all features</span>
            </div>
          )}
        </div>

        {/* Main Content */}
        <main className="animate-fadeIn">
          {renderContent()}
        </main>
      </div>

      {/* Modals */}
      <Modal
        isOpen={showKYCVerification}
        onClose={() => setShowKYCVerification(false)}
        title="Identity Verification"
      >
        <KYCVerification 
          user={{}} 
          onVerificationComplete={handleKYCComplete} 
        />
      </Modal>

      <Modal
        isOpen={showQRCode}
        onClose={() => setShowQRCode(false)}
        title="Produce QR Code"
      >
        {selectedLot && (
          <div className="text-center">
            <ProduceQRCode
              lotId={selectedLot.lotId}
              produceType={selectedLot.produceType}
              origin={selectedLot.origin}
            />
            <p className="mt-4 text-sm text-gray-600">
              Scan to verify authenticity of {selectedLot.produceType}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
};

BuyerDashboard.propTypes = {
  activeTab: PropTypes.string
};

export default BuyerDashboard;