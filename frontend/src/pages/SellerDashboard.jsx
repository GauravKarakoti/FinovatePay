import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { 
    getSellerInvoices, createInvoice, updateInvoiceStatus,
    getSellerLots, getQuotations, sellerApproveQuotation, rejectQuotation, createQuotation
} from '../utils/api';
import { connectWallet, getInvoiceFactoryContract } from '../utils/web3';
import { NATIVE_CURRENCY_ADDRESS } from '../utils/constants';
import StatsCard from '../components/Dashboard/StatsCard';
import InvoiceList from '../components/Invoice/InvoiceList';
import EscrowStatus from '../components/Escrow/EscrowStatus';
import EscrowTimeline from '../components/Escrow/EscrowTimeline';
import KYCStatus from '../components/KYC/KYCStatus';
import KYCVerification from '../components/KYC/KYCVerification';
import { generateTimelineEvents } from '../utils/timeline';
import {toast} from 'sonner';
import PaymentHistoryList from '../components/Dashboard/PaymentHistoryList';
import CreateProduceLot from '../components/Produce/CreateProduceLot';
import ProduceQRCode from '../components/Produce/ProduceQRCode';
import QuotationList from '../components/Dashboard/QuotationList';
import CreateQuotation from '../components/Quotation/CreateQuotation';

const uuidToBytes32 = (uuid) => {
    return ethers.utils.hexZeroPad('0x' + uuid.replace(/-/g, ''), 32);
};

const SellerDashboard = ({ activeTab }) => {
  const [invoices, setInvoices] = useState([]);
  const [walletAddress, setWalletAddress] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [kycStatus, setKycStatus] = useState('pending');
  const [kycRiskLevel, setKycRiskLevel] = useState('medium');
  const [showKYCVerification, setShowKYCVerification] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); // Add loading state
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [confirmingShipment, setConfirmingShipment] = useState(null); // Will hold the invoice object
  const [proofFile, setProofFile] = useState(null);
  const [showCreateProduceForm, setShowCreateProduceForm] = useState(false);
  const [selectedProduceLot, setSelectedProduceLot] = useState(null);
  const [produceLots, setProduceLots] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [showCreateQuotation, setShowCreateQuotation] = useState(false);

  const loadProduceLots = async () => {
    try {
      const response = await getSellerLots(); // Changed from getProducerLots
      setProduceLots(response.data);
    } catch (error) {
      console.error('Failed to load produce lots:', error);
      toast.error("Could not load produce lots.");
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    const { address } = await connectWallet();
    setWalletAddress(address);
    await loadData(address); // invoices
    await loadProduceLots();
    await loadQuotations(address);
  };

  const loadQuotations = async (currentAddress) => {
      try {
          const response = await getQuotations();
          // Filter quotations where the current user is the seller
          const sellerQuotations = response.data.filter(q => q.seller_address.toLowerCase() === currentAddress.toLowerCase());
          setQuotations(sellerQuotations);
      } catch (error) {
          console.error('Failed to load quotations:', error);
          toast.error("Could not load quotations.");
      }
  };

  const handleApproveQuotation = async (quotationId) => {
      try {
          await sellerApproveQuotation(quotationId);
          toast.success("Quotation approved and sent to buyer for final confirmation!");
          loadQuotations(walletAddress);
      } catch (error) {
          toast.error("Failed to approve quotation.");
      }
  };

  const handleRejectQuotation = async (quotationId) => {
      try {
          await rejectQuotation(quotationId);
          toast.info("Quotation rejected.");
          loadQuotations(walletAddress); // Refresh list
      } catch (error) {
          toast.error("Failed to reject quotation.");
      }
  };

  const handleCreateQuotation = async (quotationData) => {
      try {
          await createQuotation(quotationData);
          toast.success('Quotation sent to buyer for approval!');
          setShowCreateQuotation(false);
          loadQuotations(walletAddress);
      } catch (error) {
          toast.error('Failed to create quotation: ' + (error.response?.data?.error || error.message));
      }
  };

  const handleCreateProduceLot = async (quotation) => {
    setIsSubmitting(true);
    const creationPromise = async () => {
        const invoiceId = uuidv4();
        const bytes32InvoiceId = uuidToBytes32(invoiceId);
        const { address: sellerAddress } = await connectWallet();

        const dataToHash = `${sellerAddress}-${quotation.buyer_address}-${quotation.total_amount}-${Date.now()}`;
        const invoiceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(dataToHash));
        
        const tokenAddress = NATIVE_CURRENCY_ADDRESS; // Assuming MATIC
        
        const contract = await getInvoiceFactoryContract();
        const amountInWei = ethers.utils.parseUnits(quotation.total_amount.toString(), 18);
        const dueDateTimestamp = Math.floor(new Date().getTime() / 1000) + 86400 * 30; // 30 days from now

        toast.info("Please confirm invoice creation in your wallet...");
        const tx = await contract.createInvoice(
            bytes32InvoiceId, invoiceHash, quotation.buyer_address,
            amountInWei, dueDateTimestamp, tokenAddress
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === 'InvoiceCreated');
        if (!event) throw new Error("InvoiceCreated event not found.");
        
        const newContractAddress = event.args.invoiceContractAddress;

        const finalInvoiceData = {
            quotation_id: quotation.id, // This is the crucial link
            invoice_id: invoiceId,
            invoice_hash: invoiceHash,
            contract_address: newContractAddress,
            token_address: tokenAddress,
            due_date: new Date(dueDateTimestamp * 1000).toISOString(),
        };
        
        await createInvoice(finalInvoiceData); // Call the modified backend endpoint
    };

    try {
        await toast.promise(creationPromise(), {
            loading: "Deploying invoice contract...",
            success: () => {
                loadInitialData(); // Refresh all data
                return 'Invoice created successfully from quotation!';
            },
            error: (err) => `Invoice creation failed: ${err.reason || err.message}`
        });
    } catch (error) {
        console.error('Failed to create invoice from quotation:', error);
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleSelectProduceLot = (lot) => {
    setSelectedProduceLot(lot);
  };

  const loadData = async () => {
    try {
      const { address } = await connectWallet();
      setWalletAddress(address);
      
      const invoicesData = await getSellerInvoices();
      setInvoices(invoicesData.data);
      
      // Mock KYC status - in a real app, this would come from the API
      setKycStatus('verified');
      setKycRiskLevel('low');
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  const handleCreateInvoiceFromQuotation = async (quotation) => {
    setIsSubmitting(true);
  
    const creationPromise = async () => {
      const invoiceId = uuidv4();
      const bytes32InvoiceId = uuidToBytes32(invoiceId);
      const { address: sellerAddress } = await connectWallet();
      
      const dataToHash = `${sellerAddress}-${quotation.buyer_address}-${quotation.total_amount}-${Date.now()}`;
      const invoiceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(dataToHash));
      
      const tokenAddress = NATIVE_CURRENCY_ADDRESS; // Assuming MATIC for produce sales
      
      const contract = await getInvoiceFactoryContract();
      const amountInWei = ethers.utils.parseUnits(quotation.total_amount.toString(), 18);
      const dueDateTimestamp = Math.floor(new Date().getTime() / 1000) + 86400 * 30; // Due in 30 days
  
      toast.info("Please confirm invoice creation in your wallet...");
      const tx = await contract.createInvoice(
        bytes32InvoiceId, invoiceHash, quotation.buyer_address,
        amountInWei, dueDateTimestamp, tokenAddress
      );
  
      const receipt = await tx.wait();
      const event = receipt.events?.find(e => e.event === 'InvoiceCreated');
      if (!event) throw new Error("InvoiceCreated event not found.");
      
      const newContractAddress = event.args.invoiceContractAddress;
  
      const finalInvoiceData = {
        quotation_id: quotation.id,
        invoice_id: invoiceId,
        invoice_hash: invoiceHash,
        contract_address: newContractAddress,
        token_address: tokenAddress,
        due_date: new Date(dueDateTimestamp * 1000).toISOString(),
      };
      
      await createInvoice(finalInvoiceData);
    };
  
    try {
      await toast.promise(creationPromise(), {
        loading: "Deploying invoice contract...",
        success: () => {
          loadInitialData(); // Refresh all data
          return 'Invoice created successfully from quotation!';
        },
        error: (err) => `Invoice creation failed: ${err.reason || err.message}`
      });
    } catch (error) {
      console.error('Failed to create invoice:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmShipment = (invoice) => {
      setConfirmingShipment(invoice);
  };

  const submitShipmentProof = async () => {
      if (!proofFile || !confirmingShipment) {
          toast.error("Please select a proof of shipment file.");
          return;
      }
      setIsSubmitting(true);
      try {
          // In a real app, this would upload to IPFS. We simulate it.
          const proofHash = `bafybeigdyrzt5s6dfx7sidefusha4u62piu7k26k5e4szm3oogv5s2d2bu-${Date.now()}`;
          
          const { signer } = await connectWallet();
          const message = `I confirm the shipment for invoice ${confirmingShipment.invoice_id}.\nProof Hash: ${proofHash}`;
          
          await signer.signMessage(message);

          await updateInvoiceStatus(confirmingShipment.invoice_id, 'shipped', proofHash);
          
          toast.success('Shipment confirmed and buyer notified!');
          
          setConfirmingShipment(null);
          setProofFile(null);
          loadData();

      } catch (error) {
          console.error('Failed to confirm shipment:', error);
          toast.error('Shipment confirmation failed: ' + (error.reason || error.message));
      } finally {
          setIsSubmitting(false);
      }
  };

  const handleSelectInvoice = (invoice) => {
      setSelectedInvoice(invoice);
      setTimelineEvents(generateTimelineEvents(invoice));
  };

  const handleKYCVerificationComplete = (result) => {
    setShowKYCVerification(false);
    setKycStatus(result.verified ? 'verified' : 'failed');
    setKycRiskLevel(result.riskLevel);
    result.verified ? toast.success('KYC Verification completed successfully') : toast.error("KYC Verification failed.")
  };
  
  const escrowInvoices = invoices.filter(inv => ['deposited', 'disputed', 'shipped'].includes(inv.escrow_status));
  const completedInvoices = invoices.filter(inv => inv.escrow_status === 'released');
  
  const stats = [
      { title: 'Pending Invoices', value: invoices.filter(i => i.escrow_status === 'created').length, change: 0, icon: '📝', color: 'blue' },
      { title: 'Active Escrows', value: escrowInvoices.length, change: 0, icon: '🔒', color: 'green' },
      { title: 'Completed', value: invoices.filter(i => i.escrow_status === 'released').length, change: 0, icon: '✅', color: 'purple' },
      { title: 'Disputed', value: invoices.filter(i => i.escrow_status === 'disputed').length, change: 0, icon: '⚖️', color: 'red' },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div>
            <h2 className="text-2xl font-bold mb-6">Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {stats.map((stat, index) => (
                <StatsCard
                  key={index}
                  title={stat.title}
                  value={stat.value}
                  change={stat.change}
                  icon={stat.icon}
                  color={stat.color}
                />
              ))}
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="text-xl font-semibold mb-4">Recent Invoices</h3>
                <InvoiceList
                  invoices={invoices.slice(0, 5)}
                  onSelectInvoice={handleSelectInvoice}
                  onConfirmShipment={handleConfirmShipment}
                  userRole="seller"
                />
              </div>
              
              <div>
                <h3 className="text-xl font-semibold mb-4">KYC Status</h3>
                <KYCStatus
                  status={kycStatus}
                  riskLevel={kycRiskLevel}
                  details={kycStatus === 'verified' ? 'Your identity has been verified successfully.' : 'Please complete KYC verification to access all features.'}
                  onReverify={() => setShowKYCVerification(true)}
                />
              </div>
            </div>
          </div>
        );
      
      case 'invoices':
        return (
          <div>
            <h2 className="text-2xl font-bold mb-6">Invoices</h2>
            <InvoiceList
              invoices={invoices}
              onSelectInvoice={handleSelectInvoice}
              onConfirmShipment={handleConfirmShipment}
              userRole="seller"
            />
          </div>
        );
      
      case 'payments':
        return (
            <div>
                <h2 className="text-2xl font-bold mb-6">Payment History</h2>
                <PaymentHistoryList invoices={completedInvoices} userRole="seller" />
            </div>
        );
      
      case 'escrow':
        return (
          <div>
              <h2 className="text-2xl font-bold mb-6">Escrow Management</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <EscrowStatus
                      status={selectedInvoice}
                      onConfirm={handleConfirmShipment}
                      onDispute={(invoiceId, reason) => toast.success(`Dispute raised for invoice ${invoiceId}: ${reason}`)}
                  />
                  <EscrowTimeline events={timelineEvents} />
              </div>
              <div className="mt-6">
                  <h3 className="text-xl font-semibold mb-4">Invoices in Escrow</h3>
                  <InvoiceList
                      invoices={escrowInvoices}
                      onSelectInvoice={handleSelectInvoice}
                      onConfirmShipment={handleConfirmShipment}
                      userRole="buyer"
                  />
              </div>
          </div>
        );

      case 'produce':
        return (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Produce Management</h2>
              <button
                onClick={() => setShowCreateProduceForm(true)}
                className="btn-primary"
              >
                Register New Produce Lot
              </button>
            </div>
            
            {showCreateProduceForm ? (
              <CreateProduceLot
                onSubmit={handleCreateProduceLot}
                onCancel={() => setShowCreateProduceForm(false)}
                isSubmitting={isSubmitting}
              />
            ) : selectedProduceLot ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h3 className="text-lg font-semibold mb-4">Produce Details</h3>
                  <p><strong>Lot ID:</strong> {selectedProduceLot.lot_id}</p>
                  <p><strong>Type:</strong> {selectedProduceLot.produce_type}</p>
                  <p><strong>Origin:</strong> {selectedProduceLot.origin}</p>
                  <p><strong>Harvest Date:</strong> {new Date(selectedProduceLot.harvest_date).toLocaleDateString()}</p>
                  <p><strong>Quantity:</strong> {selectedProduceLot.quantity} kg</p>
                  <p><strong>Quality Metrics:</strong> {selectedProduceLot.quality_metrics}</p>
                  <button
                    onClick={() => setSelectedProduceLot(null)}
                    className="mt-4 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                  >
                    Back to List
                  </button>
                </div>
                <ProduceQRCode
                  lotId={selectedProduceLot.lot_id}
                  produceType={selectedProduceLot.produce_type}
                  origin={selectedProduceLot.origin}
                />
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold">Your Produce Lots</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Lot ID
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Produce Type
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Quantity
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {produceLots.map((lot) => (
                        <tr key={lot.lot_id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {lot.lot_id}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {lot.produce_type}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {lot.current_quantity} kg
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <button
                              onClick={() => handleSelectProduceLot(lot)}
                              className="text-blue-600 hover:text-blue-900 mr-3"
                            >
                              View Details
                            </button>
                            <a
                              href={`/produce/${lot.lot_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-green-600 hover:text-green-900"
                            >
                              View History
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );

      case 'quotations':
        return (
            <div>
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold">Quotations</h2>
                    <button
                        onClick={() => setShowCreateQuotation(true)}
                        className="btn-primary"
                    >
                        Create Off-Platform Quotation
                    </button>
                </div>
                
                {showCreateQuotation ? (
                    <CreateQuotation
                        onSubmit={handleCreateQuotation}
                        onCancel={() => setShowCreateQuotation(false)}
                    />
                ) : (
                    <QuotationList
                        quotations={quotations}
                        userRole="seller"
                        onApprove={handleApproveQuotation}
                        onReject={handleRejectQuotation}
                        onCreateInvoice={handleCreateInvoiceFromQuotation}
                    />
                )}
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
      {showKYCVerification ? (
        <KYCVerification 
          user={{}} // Pass user object here if available
          onVerificationComplete={handleKYCVerificationComplete} 
        />
      ) : (
        renderTabContent()
      )}

      {confirmingShipment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h3 className="text-xl font-bold mb-4">Confirm Shipment</h3>
                <p className="text-gray-600 mb-4">
                    Upload a proof of shipment (e.g., tracking receipt) and sign with your wallet to confirm.
                </p>
                
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Shipment Proof Image</label>
                    <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setProofFile(e.target.files[0])}
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                </div>

                <div className="flex justify-end space-x-3">
                    <button
                        onClick={() => {
                            setConfirmingShipment(null);
                            setProofFile(null);
                        }}
                        disabled={isSubmitting}
                        className="btn-secondary"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={submitShipmentProof}
                        disabled={!proofFile || isSubmitting}
                        className="btn-primary"
                    >
                        {isSubmitting ? 'Processing...' : 'Upload & Sign'}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default SellerDashboard;