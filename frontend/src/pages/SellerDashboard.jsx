import React, { useState, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { toast } from 'sonner';

import {
  getSellerInvoices,
  getSellerLots,
  getQuotations,
  getKYCStatus
} from '../utils/api';
import { 
  connectWallet, getInvoiceFactoryContract, getEscrowContract, getProduceTrackingContract, erc20ABI
} from '../utils/web3';
import { NATIVE_CURRENCY_ADDRESS } from '../utils/constants';
import StatsCard from '../components/Dashboard/StatsCard';
import InvoiceList from '../components/Invoice/InvoiceList';
import KYCStatus from '../components/KYC/KYCStatus';
import FiatOnRampModal from '../components/Dashboard/FiatOnRampModal';
import { generateTimelineEvents } from '../utils/timeline';

// ------------------ UI HELPERS ------------------

const LoadingSpinner = () => (
  <div className="flex justify-center py-20">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
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
                    <p className="text-xs text-gray-500 mt-1">If discount > 0, deadline must be in the future.</p>
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
  const [invoices, setInvoices] = useState([]);
  const [walletAddress, setWalletAddress] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showFiatModal, setShowFiatModal] = useState(false);

  const [kycData, setKycData] = useState({
    status: 'not_started',
    riskLevel: 'unknown',
    details: 'Pending'
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
  const [invoiceQuotation, setInvoiceQuotation] = useState(null); // For modal
  const { setStats: setGlobalStats } = useStatsActions();

  // ------------------ DATA LOADERS ------------------

  const loadKYCStatus = useCallback(async () => {
    try {
      const { data } = await getKYCStatus();
      setKycData({
        status: data?.status || 'not_started',
        riskLevel: data?.kyc_risk_level || 'unknown',
        details:
          data?.details ||
          (data?.status === 'verified'
            ? 'Verified'
            : 'Pending verification')
      });
    } catch (err) {
      console.error('KYC load failed:', err);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    try {
      const { address } = await connectWallet();
      setWalletAddress(address);

      const res = await getSellerInvoices();
      setInvoices(res?.data || []);
    } catch (err) {
      console.error('Invoice load failed:', err);
      toast.error('Failed to load invoices');
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([loadInvoices(), loadKYCStatus()]);
    setIsLoading(false);
  }, [loadInvoices, loadKYCStatus]);

  // ------------------ SOCKET EVENTS ------------------

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
      
      // Use EscrowContract instead of InvoiceFactory
      const contract = await getEscrowContract();
      const amountInWei = ethers.utils.parseUnits(quotation.total_amount.toString(), 18);

      const discountBps = Math.floor(parseFloat(discountRate || 0) * 100);
      const discountDeadlineTs = deadline ? Math.floor(new Date(deadline).getTime() / 1000) : 0;

      // Validation on frontend
      if (discountBps > 0 && discountDeadlineTs <= Math.floor(Date.now() / 1000)) {
          throw new Error("Discount deadline must be in the future");
      }

      toast.loading('Waiting for wallet confirmation...', { id: toastId });
      
      // New createEscrow signature
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
      const event = receipt.events?.find(e => e.event === 'EscrowCreated'); // Changed event name
      
      if (!event) throw new Error("EscrowCreated event not found");

      await createInvoice({
        quotation_id: quotation.id,
        invoice_id: invoiceId,
        invoice_hash: invoiceHash,
        contract_address: contract.address, // Escrow contract address is the "contract address"
        token_address: tokenAddress,
        due_date: new Date((Date.now() + 86400 * 30 * 1000)).toISOString(),
        discount_rate: discountBps,
        discount_deadline: discountDeadlineTs
      });

      toast.success('Invoice created and deployed!', { id: toastId });
      setInvoiceQuotation(null);
      await loadData();
      await loadQuotations();
    } catch (error) {
      console.error('Failed to create invoice:', error);
      toast.error(error.reason || error.message, { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  }, [invoiceQuotation, loadData, loadQuotations]);

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

    const handleDispute = () => {
      toast.error('Dispute raised');
      loadInvoices();
    };

    socket.on('escrow:released', handleEscrowRelease);
    socket.on('escrow:dispute', handleDispute);

    return () => {
      socket.off('escrow:released', handleEscrowRelease);
      socket.off('escrow:dispute', handleDispute);
    };
  }, [walletAddress, loadInvoices]);

  // ------------------ EFFECTS ------------------

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    setGlobalStats({ totalInvoices: invoices.length });
  }, [invoices, setGlobalStats]);

  // ------------------ DERIVED STATS ------------------

  const stats = useMemo(
    () => [
      {
        title: 'Pending',
        value: invoices.filter(i => i.status === 'pending').length,
        icon: '📝'
      },
      {
        title: 'Active Escrows',
        value: invoices.filter(i =>
          ['deposited', 'shipped'].includes(i.escrow_status)
        ).length,
        icon: '🔒'
      },
      {
        title: 'Completed',
        value: invoices.filter(i => i.escrow_status === 'released').length,
        icon: '✅'
      },
      {
        title: 'Disputed',
        value: invoices.filter(i => i.escrow_status === 'disputed').length,
        icon: '⚖️'
      }
    ],
    [invoices]
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
              onCreateInvoice={setInvoiceQuotation} // Open modal
          />
        ) : (
          <EmptyState message="No active quotations" icon="📋" />
        )
      )}
    </div>
  );

  // ------------------ RENDER ------------------

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* HEADER */}
        <header className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Seller Dashboard
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Wallet: {walletAddress}
              </p>
            </div>

            <button
              onClick={() => setShowFiatModal(true)}
              className="bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600 text-white px-6 py-2.5 rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2 w-fit"
            >
              Buy Crypto
            </button>
          </div>
        </header>

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {stats.map((s, i) => (
                <StatsCard key={i} {...s} />
              ))}
            </div>

            <div className="bg-white p-6 rounded-xl border shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Recent Invoices</h3>
                {invoices.length > 0 && (
                  <ExportTransactions invoices={invoices} />
                )}
              </div>
              <InvoiceList
                invoices={invoices.slice(0, 5)}
                userRole="seller"
              />
            </div>

            <div className="bg-white p-6 rounded-xl border shadow-sm">
              <h3 className="text-lg font-semibold mb-3">KYC Status</h3>
              <KYCStatus {...kycData} />
            </div>
          </>
        )}

        {/* INVOICES TAB */}
        {activeTab === 'invoices' && (
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">All Invoices</h2>
              {invoices.length > 0 && (
                <ExportTransactions invoices={invoices} />
              )}
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

        <InvoiceDetailsModal
            isOpen={!!invoiceQuotation}
            onClose={() => setInvoiceQuotation(null)}
            onSubmit={handleFinalizeInvoice}
            isSubmitting={isSubmitting}
        />
      </div>

      {/* FIAT ON-RAMP MODAL */}
      {showFiatModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <FiatOnRampModal
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