import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import PropTypes from 'prop-types';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { 
  getSellerInvoices, createInvoice, updateInvoiceStatus,
  getSellerLots, getQuotations, sellerApproveQuotation, rejectQuotation, createQuotation,
  createProduceLot as syncProduceLot, api, getKYCStatus
} from '../utils/api';
import { 
  connectWallet, getInvoiceFactoryContract, getProduceTrackingContract, erc20ABI 
} from '../utils/web3';
import { NATIVE_CURRENCY_ADDRESS } from '../utils/constants';
import StatsCard from '../components/Dashboard/StatsCard';
import InvoiceList from '../components/Invoice/InvoiceList';
import EscrowStatus from '../components/Escrow/EscrowStatus';
import EscrowTimeline from '../components/Escrow/EscrowTimeline';
import KYCStatus from '../components/KYC/KYCStatus';
import KYCVerification from '../components/KYC/KYCVerification';
import { generateTimelineEvents } from '../utils/timeline';
import PaymentHistoryList from '../components/Dashboard/PaymentHistoryList';
import CreateProduceLot from '../components/Produce/CreateProduceLot';
import ProduceQRCode from '../components/Produce/ProduceQRCode';
import QuotationList from '../components/Dashboard/QuotationList';
import CreateQuotation from '../components/Quotation/CreateQuotation';
import FinancingTab from '../components/Financing/FinancingTab';
import TokenizeInvoiceModal from '../components/Financing/TokenizeInvoiceModal';
import { useStatsActions } from '../context/StatsContext';

// --- Utility Helpers ---

const uuidToBytes32 = (uuid) => {
  return ethers.utils.hexZeroPad('0x' + uuid.replace(/-/g, ''), 32);
};

// --- Reusable UI Components ---

const LoadingSpinner = ({ size = 'md', className = '' }) => {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className={`animate-spin rounded-full border-b-2 border-blue-600 ${sizes[size]}`} role="status">
        <span className="sr-only">Loading...</span>
      </div>
    </div>
  );
};

LoadingSpinner.propTypes = { size: PropTypes.oneOf(['sm', 'md', 'lg']), className: PropTypes.string };

const EmptyState = ({ message, icon = '📭', action = null }) => (
  <div className="text-center py-12 px-4 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
    <div className="text-4xl mb-3">{icon}</div>
    <p className="text-gray-500 font-medium mb-2">{message}</p>
    {action && (
      <button onClick={action.onClick} className="text-blue-600 hover:text-blue-700 text-sm font-medium mt-2 underline">
        {action.label}
      </button>
    )}
  </div>
);

EmptyState.propTypes = {
  message: PropTypes.string.isRequired,
  icon: PropTypes.string,
  action: PropTypes.shape({ label: PropTypes.string, onClick: PropTypes.func })
};

const ActionButton = ({ 
  onClick, children, variant = 'primary', disabled = false, loading = false, className = '' 
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
    <button onClick={onClick} disabled={disabled || loading} className={`${baseClasses} ${variants[variant]} ${className}`}>
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

const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden ${className}`}>
    {children}
  </div>
);

Card.propTypes = { children: PropTypes.node, className: PropTypes.string };

const Modal = ({ isOpen, onClose, title, children, maxWidth = 'md' }) => {
  if (!isOpen) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl' };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${widths[maxWidth]} overflow-hidden`}>
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

Modal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  children: PropTypes.node,
  maxWidth: PropTypes.oneOf(['sm', 'md', 'lg', 'xl'])
};

// --- Sub-Components ---

const ProduceLotsTable = ({ lots, onSelect, onViewHistory }) => (
  <div className="overflow-x-auto">
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lot ID</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Available</th>
          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-gray-200">
        {lots.map((lot) => (
          <tr key={lot.lot_id} className="hover:bg-gray-50">
            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">#{lot.lot_id}</td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">{lot.produce_type}</td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{lot.current_quantity} kg</td>
            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-3">
              <button onClick={() => onSelect(lot)} className="text-blue-600 hover:text-blue-900">Details</button>
              <a href={`/produce/${lot.lot_id}`} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:text-green-900">
                History →
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    {lots.length === 0 && <EmptyState message="No produce lots registered yet" icon="🌾" />}
  </div>
);

ProduceLotsTable.propTypes = {
  lots: PropTypes.array.isRequired,
  onSelect: PropTypes.func.isRequired,
  onViewHistory: PropTypes.func
};

const ShipmentConfirmationModal = ({ 
  isOpen, 
  onClose, 
  invoice, 
  proofFile, 
  setProofFile, 
  onSubmit, 
  isSubmitting 
}) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Confirm Shipment" maxWidth="md">
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
              <span className="text-sm text-gray-600">Click to upload tracking receipt or proof of delivery</span>
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

ShipmentConfirmationModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  invoice: PropTypes.object,
  proofFile: PropTypes.any,
  setProofFile: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool
};

// --- Main Component ---

const SellerDashboard = ({ activeTab = 'overview' }) => {
  // Data State
  const [invoices, setInvoices] = useState([]);
  const [produceLots, setProduceLots] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [walletAddress, setWalletAddress] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [selectedProduceLot, setSelectedProduceLot] = useState(null);
  const [timelineEvents, setTimelineEvents] = useState([]);
  
  // KYC State (Consolidated)
  const [kycData, setKycData] = useState({
    status: 'not_started',
    riskLevel: 'unknown',
    details: 'Verification pending'
  });
  
  // UI State
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showKYCVerification, setShowKYCVerification] = useState(false);
  const [showCreateProduceForm, setShowCreateProduceForm] = useState(false);
  const [showCreateQuotation, setShowCreateQuotation] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [confirmingShipment, setConfirmingShipment] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [invoiceToTokenize, setInvoiceToTokenize] = useState(null);
  const [selectedLotQR, setSelectedLotQR] = useState(null);
  const { setStats: setGlobalStats } = useStatsActions();

  // Memoized Derived State
  const { escrowInvoices, completedInvoices, pendingInvoices, stats } = useMemo(() => {
    const escrow = invoices.filter(inv => ['deposited', 'disputed', 'shipped'].includes(inv.escrow_status));
    const completed = invoices.filter(inv => inv.escrow_status === 'released');
    const pending = invoices.filter(inv => inv.escrow_status === 'created');
    
    return {
      escrowInvoices: escrow,
      completedInvoices: completed,
      pendingInvoices: pending,
      stats: [
        { title: 'Pending', value: pending.length, icon: '📝', color: 'blue', desc: 'Awaiting payment' },
        { title: 'Active Escrows', value: escrow.length, icon: '🔒', color: 'green', desc: 'In transit' },
        { title: 'Completed', value: completed.length, icon: '✅', color: 'purple', desc: 'Paid out' },
        { title: 'Disputed', value: invoices.filter(i => i.escrow_status === 'disputed').length, icon: '⚖️', color: 'red', desc: 'Needs resolution' },
      ]
    };
  }, [invoices]);

  useEffect(() => {
    setGlobalStats({
      totalInvoices: invoices.length,
      activeEscrows: escrowInvoices.length,
      completed: completedInvoices.length,
      produceLots: produceLots.length
    });
  }, [invoices.length, escrowInvoices.length, completedInvoices.length, produceLots.length, setGlobalStats]);

  // Data Fetching
  const loadKYCStatus = useCallback(async () => {
    try {
      const { data } = await getKYCStatus();
      setKycData({
        status: data.status || 'not_started',
        riskLevel: data.kyc_risk_level || 'unknown',
        details: data.details || (data.status === 'verified' ? 'Verified' : 'Pending verification')
      });
    } catch (error) {
      console.error('Failed to load KYC:', error);
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      const { address } = await connectWallet();
      setWalletAddress(address);
      const invoicesData = await getSellerInvoices();
      setInvoices(invoicesData.data || []);
    } catch (error) {
      console.error('Failed to load invoices:', error);
      toast.error("Failed to load dashboard data");
    }
  }, []);

  const loadProduceLots = useCallback(async () => {
    try {
      const response = await getSellerLots();
      setProduceLots(response.data || []);
    } catch (error) {
      console.error('Failed to load produce:', error);
      toast.error("Could not load produce lots");
    }
  }, []);

  const loadQuotations = useCallback(async (currentAddress) => {
    try {
      const response = await getQuotations();
      const sellerQuotations = response.data.filter(q => 
        q.seller_address.toLowerCase() === (currentAddress || walletAddress).toLowerCase()
      );
      setQuotations(sellerQuotations);
    } catch (error) {
      console.error('Failed to load quotations:', error);
    }
  }, [walletAddress]);

  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([loadData(), loadKYCStatus()]);
    setIsLoading(false);
  }, [loadData, loadKYCStatus]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (walletAddress) loadQuotations(walletAddress);
  }, [walletAddress, loadQuotations]);

  // Event Handlers
  const handleSelectInvoice = useCallback((invoice) => {
    setSelectedInvoice(invoice);
    setTimelineEvents(generateTimelineEvents(invoice));
  }, []);

  const handleShowQRCode = useCallback((invoice) => {
    setSelectedLotQR({
      lotId: invoice.lot_id,
      produceType: invoice.produce_type,
      origin: invoice.origin,
    });
    setShowQRCode(true);
  }, []);

  const handleKYCComplete = useCallback(() => {
    setShowKYCVerification(false);
    loadKYCStatus();
    toast.success('KYC status updated');
  }, [loadKYCStatus]);

  // Blockchain Interactions
  const handleTokenizeInvoice = useCallback(async (invoiceId, { faceValue, maturityDate }) => {
    if (!invoiceToTokenize) return;
    setIsSubmitting(true);
    const toastId = toast.loading('Preparing tokenization...');

    try {
      const { provider } = await connectWallet();
      const tokenAddress = invoiceToTokenize.token_address;
      
      let decimals = 18;
      if (tokenAddress !== NATIVE_CURRENCY_ADDRESS) {
        const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, provider);
        decimals = await tokenContract.decimals();
      }
      
      const faceValueAsUint = ethers.utils.parseUnits(faceValue.toString(), decimals);
      
      const response = await api.post('/financing/tokenize', {
        invoiceId,
        faceValue: faceValueAsUint.toString(),
        maturityDate
      });

      toast.success('Invoice tokenized successfully!', { id: toastId });
      await loadData();
      setInvoiceToTokenize(null);
    } catch (error) {
      console.error('Tokenization failed:', error);
      toast.error(error.response?.data?.msg || error.message, { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  }, [invoiceToTokenize, loadData]);

  const handleCreateInvoiceFromQuotation = useCallback(async (quotation) => {
    setIsSubmitting(true);
    const toastId = toast.loading('Creating invoice contract...');

    try {
      const invoiceId = uuidv4();
      const bytes32InvoiceId = uuidToBytes32(invoiceId);
      const { address: sellerAddress } = await connectWallet();
      
      const dataToHash = `${sellerAddress}-${quotation.buyer_address}-${quotation.total_amount}-${Date.now()}`;
      const invoiceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(dataToHash));
      const tokenAddress = NATIVE_CURRENCY_ADDRESS;
      
      const contract = await getInvoiceFactoryContract();
      const amountInWei = ethers.utils.parseUnits(quotation.total_amount.toString(), 18);
      const dueDateTimestamp = Math.floor(Date.now() / 1000) + 86400 * 30;

      toast.loading('Waiting for wallet confirmation...', { id: toastId });
      
      const tx = await contract.createInvoice(
        bytes32InvoiceId, invoiceHash, quotation.buyer_address,
        amountInWei, dueDateTimestamp, tokenAddress
      );
      
      toast.loading('Mining transaction...', { id: toastId });
      const receipt = await tx.wait();
      const event = receipt.events?.find(e => e.event === 'InvoiceCreated');
      
      if (!event) throw new Error("InvoiceCreated event not found");

      await createInvoice({
        quotation_id: quotation.id,
        invoice_id: invoiceId,
        invoice_hash: invoiceHash,
        contract_address: event.args.invoiceContractAddress,
        token_address: tokenAddress,
        due_date: new Date(dueDateTimestamp * 1000).toISOString(),
      });

      toast.success('Invoice created and deployed!', { id: toastId });
      await loadData();
      await loadQuotations();
    } catch (error) {
      console.error('Failed to create invoice:', error);
      toast.error(error.reason || error.message, { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  }, [loadData, loadQuotations]);

  const handleCreateProduceLot = useCallback(async (formData) => {
    setIsSubmitting(true);
    const toastId = toast.loading('Registering on blockchain...');

    try {
      const contract = await getProduceTrackingContract();
      const tx = await contract.createProduceLot(
        formData.produceType,
        formData.harvestDate,
        formData.qualityMetrics,
        formData.origin,
        ethers.utils.parseUnits(formData.quantity.toString(), 18),
        ""
      );

      toast.loading('Confirming transaction...', { id: toastId });
      const receipt = await tx.wait();
      const event = receipt.events?.find(e => e.event === 'ProduceLotCreated');
      
      if (!event) throw new Error("ProduceLotCreated event not found");

      await syncProduceLot({
        ...formData,
        lotId: event.args.lotId.toNumber(),
        txHash: tx.hash,
      });

      toast.success('Produce lot registered!', { id: toastId });
      setShowCreateProduceForm(false);
      await loadProduceLots();
    } catch (error) {
      console.error('Failed to create lot:', error);
      toast.error(error.reason || error.message, { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  }, [loadProduceLots]);

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
      await loadData();
    } catch (error) {
      console.error('Shipment confirmation failed:', error);
      toast.error(error.reason || error.message, { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  }, [proofFile, confirmingShipment, loadData]);

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

  const handleCreateQuotation = useCallback(async (quotationData) => {
    try {
      await createQuotation(quotationData);
      toast.success('Quotation sent to buyer!');
      setShowCreateQuotation(false);
      await loadQuotations();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to create quotation');
    }
  }, [loadQuotations]);

  // Tab Content Components
  const OverviewTab = () => (
    <div className="space-y-6 animate-fadeIn">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <StatsCard key={index} {...stat} />
        ))}
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Invoices</h3>
          {invoices.length > 0 ? (
            <InvoiceList
              invoices={invoices.slice(0, 5)}
              onSelectInvoice={handleSelectInvoice}
              onConfirmShipment={setConfirmingShipment}
              onShowQRCode={handleShowQRCode}
              userRole="seller"
            />
          ) : (
            <EmptyState message="No invoices yet" icon="📝" />
          )}
        </Card>
        
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">KYC Status</h3>
          <KYCStatus
            status={kycData.status}
            riskLevel={kycData.riskLevel}
            details={kycData.details}
            onReverify={() => setShowKYCVerification(true)}
          />
        </Card>
      </div>
    </div>
  );

  const InvoicesTab = () => (
    <Card className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-gray-900">All Invoices</h2>
        <span className="text-sm text-gray-500">{invoices.length} total</span>
      </div>
      <InvoiceList
        invoices={invoices}
        onSelectInvoice={handleSelectInvoice}
        onConfirmShipment={setConfirmingShipment}
        onShowQRCode={handleShowQRCode}
        userRole="seller"
      />
    </Card>
  );

  const PaymentsTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Payment History</h2>
      {completedInvoices.length > 0 ? (
        <PaymentHistoryList invoices={completedInvoices} userRole="seller" />
      ) : (
        <EmptyState message="No completed payments yet" icon="💰" />
      )}
    </div>
  );

  const EscrowTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Escrow Management</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EscrowStatus
          invoice={selectedInvoice}
          onConfirm={setConfirmingShipment}
          onDispute={(id, reason) => toast.success(`Dispute raised: ${reason}`)}
        />
        <EscrowTimeline events={timelineEvents} />
      </div>
      
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Active Escrows</h3>
        <InvoiceList
          invoices={escrowInvoices}
          onSelectInvoice={handleSelectInvoice}
          onConfirmShipment={setConfirmingShipment}
          userRole="seller"
        />
      </Card>
    </div>
  );

  const ProduceTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Produce Management</h2>
        <ActionButton onClick={() => setShowCreateProduceForm(true)} variant="primary">
          + Register New Lot
        </ActionButton>
      </div>

      {showCreateProduceForm ? (
        <Card className="p-6">
          <CreateProduceLot
            onSubmit={handleCreateProduceLot}
            onCancel={() => setShowCreateProduceForm(false)}
            isSubmitting={isSubmitting}
          />
        </Card>
      ) : selectedProduceLot ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-gray-900">Lot #{selectedProduceLot.lot_id}</h3>
              <button 
                onClick={() => setSelectedProduceLot(null)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                ← Back to List
              </button>
            </div>
            <dl className="space-y-3">
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-500">Type</span>
                <span className="font-medium">{selectedProduceLot.produce_type}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-500">Origin</span>
                <span className="font-medium">{selectedProduceLot.origin}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-500">Harvest Date</span>
                <span className="font-medium">{new Date(selectedProduceLot.harvest_date).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-500">Initial Qty</span>
                <span className="font-medium">{selectedProduceLot.quantity} kg</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Available</span>
                <span className="font-medium text-green-600">{selectedProduceLot.current_quantity} kg</span>
              </div>
            </dl>
          </Card>
          <Card className="p-6 flex flex-col items-center justify-center bg-gray-50">
            <ProduceQRCode
              lotId={selectedProduceLot.lot_id}
              produceType={selectedProduceLot.produce_type}
              origin={selectedProduceLot.origin}
            />
            <p className="text-sm text-gray-500 mt-4 text-center">
              Scan to verify authenticity and view complete history
            </p>
          </Card>
        </div>
      ) : (
        <Card>
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Your Produce Lots</h3>
          </div>
          <ProduceLotsTable 
            lots={produceLots} 
            onSelect={setSelectedProduceLot} 
          />
        </Card>
      )}
    </div>
  );

  const QuotationsTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Quotations</h2>
        <ActionButton onClick={() => setShowCreateQuotation(true)} variant="primary">
          + Create Quotation
        </ActionButton>
      </div>

      {showCreateQuotation ? (
        <Card className="p-6">
          <CreateQuotation
            onSubmit={handleCreateQuotation}
            onCancel={() => setShowCreateQuotation(false)}
          />
        </Card>
      ) : (
        quotations.length > 0 ? (
          <QuotationList
            quotations={quotations}
            userRole="seller"
            onApprove={handleApproveQuotation}
            onReject={handleRejectQuotation}
            onCreateInvoice={handleCreateInvoiceFromQuotation}
          />
        ) : (
          <EmptyState message="No active quotations" icon="📋" />
        )
      )}
    </div>
  );

  const renderContent = () => {
    if (isLoading) return <LoadingSpinner size="lg" className="py-20" />;
    
    switch (activeTab) {
      case 'overview': return <OverviewTab />;
      case 'invoices': return <InvoicesTab />;
      case 'payments': return <PaymentsTab />;
      case 'escrow': return <EscrowTab />;
      case 'produce': return <ProduceTab />;
      case 'quotations': return <QuotationsTab />;
      case 'financing': return (
        <FinancingTab
          invoices={invoices}
          onTokenizeClick={setInvoiceToTokenize}
        />
      );
      default: return <OverviewTab />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Seller Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage produce, invoices, and financing
          </p>
        </header>

        {showKYCVerification ? (
          <KYCVerification 
            user={{}} 
            onVerificationComplete={handleKYCComplete} 
          />
        ) : (
          renderContent()
        )}

        {/* Modals */}
        {invoiceToTokenize && (
          <TokenizeInvoiceModal
            invoice={invoiceToTokenize}
            onClose={() => setInvoiceToTokenize(null)}
            onSubmit={handleTokenizeInvoice}
            isSubmitting={isSubmitting}
          />
        )}

        <Modal 
          isOpen={showQRCode} 
          onClose={() => setShowQRCode(false)} 
          title="Produce QR Code"
        >
          {selectedLotQR && (
            <div className="text-center">
              <ProduceQRCode {...selectedLotQR} />
              <p className="mt-4 text-sm text-gray-600">
                {selectedLotQR.produceType} from {selectedLotQR.origin}
              </p>
            </div>
          )}
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
      </div>
    </div>
  );
};

SellerDashboard.propTypes = {
  activeTab: PropTypes.string
};

export default SellerDashboard;