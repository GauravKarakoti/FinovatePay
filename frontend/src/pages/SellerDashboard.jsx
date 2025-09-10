import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers'; // Import ethers
import { v4 as uuidv4 } from 'uuid';
import { 
  getSellerInvoices, 
  createInvoice,  
  confirmRelease,
  updateInvoiceStatus
} from '../utils/api';
import { connectWallet, getInvoiceFactoryContract } from '../utils/web3';
import { TOKEN_ADDRESSES, NATIVE_CURRENCY_ADDRESS } from '../utils/constants';
import StatsCard from '../components/Dashboard/StatsCard';
import InvoiceForm from '../components/Invoice/InvoiceForm';
import InvoiceList from '../components/Invoice/InvoiceList';
import EscrowStatus from '../components/Escrow/EscrowStatus';
import EscrowTimeline from '../components/Escrow/EscrowTimeline';
import KYCStatus from '../components/KYC/KYCStatus';
import KYCVerification from '../components/KYC/KYCVerification';
import { generateTimelineEvents } from '../utils/timeline';
import {toast} from 'sonner';
const uuidToBytes32 = (uuid) => {
    return ethers.utils.hexZeroPad('0x' + uuid.replace(/-/g, ''), 32);
};

const SellerDashboard = ({ activeTab }) => {
  const [invoices, setInvoices] = useState([]);
  const [walletAddress, setWalletAddress] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [kycStatus, setKycStatus] = useState('pending');
  const [kycRiskLevel, setKycRiskLevel] = useState('medium');
  const [showKYCVerification, setShowKYCVerification] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); // Add loading state
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [confirmingShipment, setConfirmingShipment] = useState(null); // Will hold the invoice object
  const [proofFile, setProofFile] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

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

  const handleCreateInvoice = async (invoiceData) => {
      setIsSubmitting(true);
      try {
          const invoiceId = uuidv4();
          const bytes32InvoiceId = uuidToBytes32(invoiceId);
          const { address: sellerAddress } = await connectWallet();
          const dataToHash = `${sellerAddress}-${invoiceData.buyer_address}-${invoiceData.amount}-${Date.now()}`;
          const invoiceHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(dataToHash));

          // Determine the token address based on currency
          const tokenAddress = invoiceData.currency === 'MATIC' 
              ? NATIVE_CURRENCY_ADDRESS 
              : TOKEN_ADDRESSES[invoiceData.currency];

          if (!tokenAddress) {
              throw new Error(`Currency '${invoiceData.currency}' is not supported.`);
          }

          const contract = await getInvoiceFactoryContract();
          const amountInWei = ethers.utils.parseUnits(invoiceData.amount.toString(), 18);
          const dueDateTimestamp = Math.floor(new Date(invoiceData.due_date).getTime() / 1000);

          console.log("Creating invoice contract via factory...");
          const tx = await contract.createInvoice(
              bytes32InvoiceId, invoiceHash, invoiceData.buyer_address,
              amountInWei, dueDateTimestamp, tokenAddress
          );

          const receipt = await tx.wait();
          const event = receipt.events?.find(e => e.event === 'InvoiceCreated');
          if (!event) throw new Error("InvoiceCreated event not found.");
          
          const newContractAddress = event.args.invoiceContractAddress;
          (`Invoice contract deployed at ${newContractAddress}! Saving to DB...`);
          
          const finalInvoiceData = {
              ...invoiceData,
              invoice_id: invoiceId,
              invoice_hash: invoiceHash,
              contract_address: newContractAddress,
              token_address: tokenAddress,
          };
          
          await createInvoice(finalInvoiceData);
          
          toast.success('Invoice created successfully!');
          setShowCreateForm(false);
          loadData();

      } catch (error) {
          console.error('Failed to create invoice:', error);
          toast.error('Invoice creation failed: ' + (error.reason || error.message));
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
          // Step 1: Upload the proof to a storage service (e.g., IPFS)
          // In a real app, you would use a library like ipfs-http-client.
          // For this example, we'll simulate the upload and generate a fake hash.
          console.log("Uploading proof to decentralized storage...");
          const proofHash = `bafybeigdyrzt5s6dfx7sidefusha4u62piu7k26k5e4szm3oogv5s2d2bu-${Date.now()}`;
          toast.success(`Proof "uploaded" successfully!\nIPFS CID: ${proofHash}`);

          // Step 2: Prepare a message and ask the seller to sign it
          const { signer } = await connectWallet();
          const message = `I confirm the shipment for invoice ${confirmingShipment.invoice_id}.\nProof Hash: ${proofHash}`;
          
          console.log("Requesting seller signature for the following message:\n", message);
          const signature = await signer.signMessage(message);
          console.log("Signature received:", signature);

          // Step 3: Send the proof hash to the backend to update the status
          // We pass the proofHash in place of the tx_hash
          await updateInvoiceStatus(confirmingShipment.invoice_id, 'shipped', proofHash);
          
          toast.success('Shipment confirmed and buyer notified!');
          
          // Step 4: Clean up state and refresh data
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
      // Generate and set the timeline events whenever an invoice is selected
      setTimelineEvents(generateTimelineEvents(invoice));
  };

  const handleKYCVerificationComplete = (result) => {
    setShowKYCVerification(false);
    setKycStatus(result.verified ? 'verified' : 'failed');
    setKycRiskLevel(result.riskLevel);
    result.verified ? toast.success('KYC Verification completed successfully') : toast.error("KYC Verification failed.")
  };

  // Mock data for stats cards
  const stats = [
    { title: 'Total Invoices', value: '24', change: 12, icon: '📝', color: 'blue' },
    { title: 'Active Escrows', value: '3', change: -5, icon: '🔒', color: 'green' },
    { title: 'Completed', value: '18', change: 8, icon: '✅', color: 'purple' },
    { title: 'Total Revenue', value: '$42,500', change: 15, icon: '💰', color: 'orange' },
  ];

  const escrowInvoices = invoices.filter(inv => ['deposited', 'disputed', 'shipped'].includes(inv.escrow_status));

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
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Invoices</h2>
              <button
                onClick={() => setShowCreateForm(true)}
                className="btn-primary"
              >
                Create New Invoice
              </button>
            </div>
            
            {showCreateForm ? (
              <InvoiceForm
                onSubmit={handleCreateInvoice}
                onCancel={() => setShowCreateForm(false)}
              />
            ) : (
              <InvoiceList
                invoices={invoices}
                onSelectInvoice={handleSelectInvoice}
                onConfirmShipment={handleConfirmShipment}
                userRole="seller"
              />
            )}
          </div>
        );
      
      case 'payments':
        return (
          <div>
            <h2 className="text-2xl font-bold mb-6">Payments</h2>
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-semibold mb-4">Payment History</h3>
              <p className="text-gray-600">Your payment history will appear here once you have completed transactions.</p>
            </div>
          </div>
        );
      
      case 'escrow':
        return (
          <div>
              <h2 className="text-2xl font-bold mb-6">Escrow Management</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Pass the full selectedInvoice object */}
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
          user={user} 
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
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-finovate-blue-50 file:text-finovate-blue-700 hover:file:bg-finovate-blue-100"
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