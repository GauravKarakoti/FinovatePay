import { useState, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { ethers } from 'ethers';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import ProduceQRCode from '../components/Produce/ProduceQRCode';
import {
  getSellerInvoices,
  getKYCStatus,
  createInvoice,
  updateInvoiceStatus,
  getQuotations,
  sellerApproveQuotation,
  rejectQuotation,
  raiseDispute
} from '../utils/api';
import { 
  connectWallet, getEscrowContract
} from '../utils/web3';
import { NATIVE_CURRENCY_ADDRESS } from '../utils/constants';

import StatsCard from '../components/Dashboard/StatsCard';
import InvoiceList from '../components/Invoice/InvoiceList';
import KYCStatus from '../components/KYC/KYCStatus';
import KYCVerification from '../components/KYC/KYCVerification';
import FiatOnRampModal from '../components/Dashboard/FiatOnRampModal';
import ExportTransactions from '../components/ExportTransactions';
import { useStatsActions } from '../context/StatsContext';

// --- New Imports for the Missing Tabs ---
import QuotationList from '../components/Dashboard/QuotationList';
import CreateProduceLot from '../components/Produce/CreateProduceLot';
import PaymentHistoryList from '../components/Dashboard/PaymentHistoryList';
import FinancingTab from '../components/Financing/FinancingTab';
import StreamingTab from '../components/Streaming/StreamingTab';
import FiatOnRamp from '../components/FiatOnRamp';
import AnalyticsPage from '../pages/AnalyticsPage';
import AuctionList from '../components/Auction/AuctionList';

// ------------------ HELPER COMPONENTS ------------------

const LoadingSpinner = () => (
  <div className="flex items-center justify-center py-12">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" role="status">
      <span className="sr-only">Loading...</span>
    </div>
  </div>
);

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

// ------------------ SELLER SPECIFIC MODALS ------------------

const ShipmentConfirmationModal = ({ 
  isOpen, onClose, invoice, proofFile, setProofFile, onSubmit, isSubmitting 
}) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Confirm Shipment">
    <div className="space-y-4">
      <p className="text-gray-600">
        Upload proof of shipment for invoice <strong>#{invoice?.invoice_id?.substring(0, 8)}...</strong>
      </p>
      
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
        <input
          type="file"
          accept="image/*,.pdf"
          onChange={(e) => setProofFile(e.target.files[0])}
          className="hidden"
          id="shipment-proof"
        />
        <label htmlFor="shipment-proof" className="cursor-pointer block">
          {proofFile ? (
            <div className="text-green-600 font-medium">✓ {proofFile.name}</div>
          ) : (
            <>
              <div className="text-gray-400 text-3xl mb-2">📎</div>
              <span className="text-sm text-gray-600">Click to upload tracking receipt</span>
            </>
          )}
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <ActionButton onClick={onClose} variant="secondary" disabled={isSubmitting}>Cancel</ActionButton>
        <ActionButton 
          onClick={onSubmit} 
          disabled={!proofFile || isSubmitting} 
          loading={isSubmitting}
          variant="primary"
        >
          Sign & Confirm
        </ActionButton>
      </div>
    </div>
  </Modal>
);

const InvoiceDetailsModal = ({ isOpen, onClose, onSubmit, isSubmitting }) => {
    const [discountRate, setDiscountRate] = useState(0);
    const [deadline, setDeadline] = useState('');

    if (!isOpen) return null;

    const handleSubmit = () => {
        onSubmit({ discountRate, deadline });
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Finalize Invoice Terms">
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Early Payment Discount (%)</label>
                    <input
                        type="number"
                        value={discountRate}
                        onChange={e => setDiscountRate(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md mt-1"
                        min="0" max="100"
                        placeholder="e.g., 2"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Discount Deadline</label>
                    <input
                        type="datetime-local"
                        value={deadline}
                        onChange={e => setDeadline(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md mt-1"
                    />
                    <p className="text-xs text-gray-500 mt-1">If discount &gt; 0, deadline must be in the future.</p>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                    <ActionButton onClick={onClose} variant="secondary" disabled={isSubmitting}>Cancel</ActionButton>
                    <ActionButton onClick={handleSubmit} loading={isSubmitting} variant="primary">
                        Create Invoice
                    </ActionButton>
                </div>
            </div>
        </Modal>
    );
};

// ------------------ UTILS ------------------
const uuidToBytes32 = (uuid) => ethers.utils.hexZeroPad('0x' + uuid.replace(/-/g, ''), 32);

// ------------------ MAIN COMPONENT ------------------

const SellerDashboard = ({ activeTab = 'overview' }) => {
  const [invoices, setInvoices] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [walletAddress, setWalletAddress] = useState('');
  const [showFiatModal, setShowFiatModal] = useState(false);
  const [selectedQRCode, setSelectedQRCode] = useState(null);
  const [kycData, setKycData] = useState({
    status: 'not_started',
    riskLevel: 'unknown',
    details: 'Pending'
  });
  
  // UI State
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showKYCVerification, setShowKYCVerification] = useState(false);
  const [confirmingShipment, setConfirmingShipment] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [invoiceQuotation, setInvoiceQuotation] = useState(null); 
  const { setStats: setGlobalStats } = useStatsActions();

  // ------------------ DATA LOADERS ------------------

  const loadKYCStatus = useCallback(async () => {
    try {
      const { data } = await getKYCStatus();
      setKycData({
        status: data?.status || 'not_started',
        riskLevel: data?.kyc_risk_level || 'unknown',
        details: data?.details || (data?.status === 'verified' ? 'Verified' : 'Pending verification')
      });
    } catch (err) {
      console.error('KYC load failed:', err);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    try {
      const res = await getSellerInvoices();
      setInvoices(res?.data || []);
    } catch (err) {
      console.error('Invoice load failed:', err);
      toast.error('Failed to load invoices');
    }
  }, []);

  const loadQuotations = useCallback(async () => {
    try {
      const { data } = await getQuotations();
      setQuotations(data || []);
    } catch (error) {
      console.error('Failed to load quotations:', error);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { address } = await connectWallet();
      setWalletAddress(address);
      await Promise.all([loadInvoices(), loadKYCStatus(), loadQuotations()]);
    } catch (error) {
      console.error('Initial load failed', error);
      toast.error('Please connect your wallet');
    } finally {
      setIsLoading(false);
    }
  }, [loadInvoices, loadKYCStatus, loadQuotations]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    const activeEscrows = invoices.filter(inv => ['deposited', 'disputed', 'shipped'].includes(inv.escrow_status)).length;
    const completed = invoices.filter(inv => inv.escrow_status === 'released').length;
    
    setGlobalStats({ 
      totalInvoices: invoices.length,
      activeEscrows,
      completed
    });
  }, [invoices, setGlobalStats]);


  // ------------------ HANDLERS ------------------

  const handleKYCComplete = useCallback((result) => {
    setShowKYCVerification(false);
    loadKYCStatus();
    toast[result.verified ? 'success' : 'error'](
      result.verified ? 'Identity verified successfully!' : 'Verification failed'
    );
  }, [loadKYCStatus]);

  const handleFinalizeInvoice = useCallback(async ({ discountRate, deadline }) => {
    if (!invoiceQuotation) return;
    const quotation = invoiceQuotation;

    setIsSubmitting(true);
    const toastId = toast.loading('Creating invoice contract...');

    try {
      const invoiceId = uuidv4();
      const bytes32InvoiceId = uuidToBytes32(invoiceId);
      const { address: sellerAddress } = await connectWallet();
      
      const dataToHash = `${sellerAddress}-${quotation.buyer_address}-${quotation.total_amount}-${Date.now()}`;
      const invoiceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(dataToHash));
      const tokenAddress = NATIVE_CURRENCY_ADDRESS;
      
      const contract = await getEscrowContract();
      const amountInWei = ethers.utils.parseUnits(quotation.total_amount.toString(), 18);

      const discountBps = Math.floor(parseFloat(discountRate || 0) * 100);
      const discountDeadlineTs = deadline ? Math.floor(new Date(deadline).getTime() / 1000) : 0;

      if (discountBps > 0 && discountDeadlineTs <= Math.floor(Date.now() / 1000)) {
          throw new Error("Discount deadline must be in the future");
      }

      toast.loading('Waiting for wallet confirmation...', { id: toastId });
      
      const tx = await contract.createEscrow(
        bytes32InvoiceId,
        sellerAddress,
        quotation.buyer_address,
        amountInWei,
        tokenAddress,
        86400 * 30, // Default duration
        ethers.constants.AddressZero, // rwaNftContract
        0, // rwaTokenId
        discountBps,
        discountDeadlineTs
      );
      
      toast.loading('Mining transaction...', { id: toastId });
      const receipt = await tx.wait();
      const event = receipt.events?.find(e => e.event === 'EscrowCreated');
      
      if (!event) throw new Error("EscrowCreated event not found");

      await createInvoice({
        quotation_id: quotation.id,
        invoice_id: invoiceId,
        invoice_hash: invoiceHash,
        contract_address: contract.address, 
        token_address: tokenAddress,
        due_date: new Date((Date.now() + 86400 * 30 * 1000)).toISOString(),
        discount_rate: discountBps,
        discount_deadline: discountDeadlineTs
      });

      toast.success('Invoice created and deployed!', { id: toastId });
      setInvoiceQuotation(null);
      await loadInvoices();
      await loadQuotations();
    } catch (error) {
      console.error('Failed to create invoice:', error);
      toast.error(error.reason || error.message, { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  }, [invoiceQuotation, loadInvoices, loadQuotations]);

  const submitShipmentProof = useCallback(async () => {
    if (!proofFile || !confirmingShipment) return;
    
    setIsSubmitting(true);
    const toastId = toast.loading('Uploading proof and signing...');

    try {
      const proofHash = `bafybeigdyrzt5s6dfx7sidefusha4u62piu7k26k5e4szm3oogv5s2d2bu-${Date.now()}`;
      const { signer } = await connectWallet();
      const message = `Confirm shipment for invoice ${confirmingShipment.invoice_id}\nProof: ${proofHash}`;
      
      await signer.signMessage(message);
      await updateInvoiceStatus(confirmingShipment.invoice_id, 'shipped', proofHash);
      
      toast.success('Shipment confirmed!', { id: toastId });
      setConfirmingShipment(null);
      setProofFile(null);
      await loadInvoices();
    } catch (error) {
      console.error('Shipment confirmation failed:', error);
      toast.error(error.reason || error.message, { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  }, [proofFile, confirmingShipment, loadInvoices]);

  const handleApproveQuotation = useCallback(async (quotationId) => {
    try {
      await sellerApproveQuotation(quotationId);
      toast.success('Quotation approved! Waiting for buyer confirmation.');
      await loadQuotations();
    } catch (error) {
      toast.error("Failed to approve quotation");
    }
  }, [loadQuotations]);

  const handleRejectQuotation = useCallback(async (quotationId) => {
    try {
      await rejectQuotation(quotationId);
      toast.info("Quotation rejected");
      await loadQuotations();
    } catch (error) {
      toast.error("Failed to reject");
    }
  }, [loadQuotations]);

  const handleRaiseDispute = useCallback(async (invoice) => {
    const reason = prompt('Enter reason for dispute:');
    if (!reason?.trim()) return;
    try {
      if(raiseDispute) {
         await raiseDispute(invoice.invoice_id, reason);
      }
      toast.success('Dispute raised');
      await loadInvoices();
    } catch (error) {
      toast.error('Failed to raise dispute');
    }
  }, [loadInvoices]);

  // ------------------ DERIVED STATS ------------------

  const stats = useMemo(() => [
    {
      title: 'Pending',
      value: invoices.filter(i => i.status === 'pending').length,
      icon: '📝', color: 'blue'
    },
    {
      title: 'Active Escrows',
      value: invoices.filter(i => ['deposited', 'shipped'].includes(i.escrow_status)).length,
      icon: '🔒', color: 'green'
    },
    {
      title: 'Completed',
      value: invoices.filter(i => i.escrow_status === 'released').length,
      icon: '✅', color: 'purple'
    },
    {
      title: 'Disputed',
      value: invoices.filter(i => i.escrow_status === 'disputed').length,
      icon: '⚖️', color: 'red'
    }
  ], [invoices]);

  const escrowInvoices = useMemo(() => invoices.filter(inv => ['deposited', 'shipped', 'disputed'].includes(inv.escrow_status)), [invoices]);
  const completedInvoices = useMemo(() => invoices.filter(inv => inv.escrow_status === 'released'), [invoices]);

  // ------------------ TAB COMPONENTS ------------------

  const OverviewTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <StatsCard key={`${stat.title}-${index}`} {...stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Recent Invoices</h3>
              {invoices.length > 0 && <ExportTransactions invoices={invoices} />}
            </div>
            <div className="p-6">
              {invoices.length > 0 ? (
                <InvoiceList
                  invoices={invoices.slice(0, 5)}
                  userRole="seller"
                  onRaiseDispute={handleRaiseDispute}
                  onConfirmShipment={(invoice) => setConfirmingShipment(invoice)}
                  onShowQRCode={(invoice) => setSelectedQRCode(invoice)} // <-- ADD THIS
                />
              ) : (
                <EmptyState message="No invoices yet" />
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <FiatOnRamp walletAddress={walletAddress} />
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <KYCStatus
              status={kycData.status}
              riskLevel={kycData.riskLevel}
              details={kycData.details}
              onReverify={() => setShowKYCVerification(true)}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const InvoicesTab = () => (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-900">All Invoices</h2>
        {invoices.length > 0 && <ExportTransactions invoices={invoices} />}
      </div>
      <div className="p-6">
        {invoices.length > 0 ? (
          <InvoiceList
            invoices={invoices}
            userRole="seller"
            onRaiseDispute={handleRaiseDispute}
            onConfirmShipment={(invoice) => setConfirmingShipment(invoice)}
            onShowQRCode={(invoice) => setSelectedQRCode(invoice)} // <-- ADD THIS
          />
        ) : (
          <EmptyState message="No invoices found" />
        )}
      </div>
    </div>
  );

  const QuotationsTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Quotations</h2>
      </div>
      {quotations.length > 0 ? (
        <QuotationList 
          quotations={quotations} 
          userRole="seller" 
          onApprove={handleApproveQuotation} 
          onReject={handleRejectQuotation} 
          onCreateInvoice={(quotation) => setInvoiceQuotation(quotation)}
        />
      ) : (
        <EmptyState message="No quotations found" icon="📋" />
      )}
    </div>
  );

  const ProduceTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Manage Produce</h2>
      <CreateProduceLot onSuccess={() => toast.success('Produce lot created successfully!')} />
    </div>
  );

  const PaymentsTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Payment History</h2>
      {completedInvoices.length > 0 ? (
        <PaymentHistoryList invoices={completedInvoices} userRole="seller" />
      ) : (
        <EmptyState message="No completed payments yet" icon="💳" />
      )}
    </div>
  );

  const EscrowTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Active Escrows</h2>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden p-6">
        {escrowInvoices.length > 0 ? (
          <InvoiceList
            invoices={escrowInvoices}
            userRole="seller"
            onRaiseDispute={handleRaiseDispute}
            onConfirmShipment={(invoice) => setConfirmingShipment(invoice)}
            onShowQRCode={(invoice) => setSelectedQRCode(invoice)} // <-- ADD THIS
          />
        ) : (
          <EmptyState message="No active escrows" icon="🔓" />
        )}
      </div>
    </div>
  );

const FinancingTabComponent = () => (
    <div className="space-y-6">
      <FinancingTab invoices={invoices} userRole="seller" />
    </div>
  );

  const StreamingTabComponent = () => (
    <div className="space-y-6">
      <StreamingTab userRole="seller" />
    </div>
  );

  const renderContent = () => {
    if (isLoading) return <LoadingSpinner />;
    switch (activeTab) {
      case 'overview': return <OverviewTab />;
      case 'invoices': return <InvoicesTab />;
      case 'quotations': return <QuotationsTab />;
      case 'produce': return <ProduceTab />;
      case 'payments': return <PaymentsTab />;
      case 'escrow': return <EscrowTab />;
      case 'financing': return <FinancingTabComponent />;
      case 'streaming': return <StreamingTabComponent />;
      case 'analytics': return <AnalyticsPage activeTab={activeTab} />;
      case 'auctions': return <AuctionList />;
      default: return <OverviewTab />;
    }
  };

  // ------------------ RENDER ------------------

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Seller Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500">
              Wallet: <span className="font-mono bg-gray-100 px-2 py-1 rounded">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowFiatModal(true)}
              className="bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600 text-white px-6 py-2.5 rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Buy Crypto
            </button>
            {kycData.status !== 'verified' && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 flex items-center gap-2">
                <span className="text-yellow-600">⚠️</span>
                <span className="text-sm text-yellow-800">Complete KYC to unlock all features</span>
              </div>
            )}
          </div>
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

      <ShipmentConfirmationModal
        isOpen={!!confirmingShipment}
        onClose={() => {
          setConfirmingShipment(null);
          setProofFile(null);
        }}
        invoice={confirmingShipment}
        proofFile={proofFile}
        setProofFile={setProofFile}
        onSubmit={submitShipmentProof}
        isSubmitting={isSubmitting}
      />

      <InvoiceDetailsModal
        isOpen={!!invoiceQuotation}
        onClose={() => setInvoiceQuotation(null)}
        onSubmit={handleFinalizeInvoice}
        isSubmitting={isSubmitting}
      />

      <Modal
        isOpen={!!selectedQRCode}
        onClose={() => setSelectedQRCode(null)}
        title="Produce Passport & Tracking"
      >
        {selectedQRCode && (
          <ProduceQRCode 
            lotId={selectedQRCode.invoice_id} 
            produceType={selectedQRCode.description || "Produce"} 
            origin={walletAddress} 
          />
        )}
      </Modal>

      {showFiatModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <FiatOnRampModal
            walletAddress={walletAddress}
            onClose={() => setShowFiatModal(false)}
            onSuccess={amount => {
              toast.success(`Successfully purchased ${amount} USDC`);
              setShowFiatModal(false);
            }}
          />
        </div>
      )}
    </div>
  );
};

SellerDashboard.propTypes = {
  activeTab: PropTypes.string
};

export default SellerDashboard;