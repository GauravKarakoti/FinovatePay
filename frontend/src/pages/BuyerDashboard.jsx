import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { getBuyerInvoices, updateInvoiceStatus } from '../utils/api';
import { connectWallet, erc20ABI } from '../utils/web3';
import StatsCard from '../components/Dashboard/StatsCard';
import InvoiceList from '../components/Invoice/InvoiceList';
import EscrowStatus from '../components/Escrow/EscrowStatus';
import EscrowTimeline from '../components/Escrow/EscrowTimeline';
import KYCStatus from '../components/KYC/KYCStatus';
import InvoiceContractABI from '../../../deployed/Invoice.json';
import { generateTimelineEvents } from '../utils/timeline';
import {toast} from 'sonner';

const BuyerDashboard = ({ activeTab }) => {
    const [invoices, setInvoices] = useState([]);
    const [walletAddress, setWalletAddress] = useState('');
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [timelineEvents, setTimelineEvents] = useState([]);
    const [kycStatus, setKycStatus] = useState('verified');
    const [kycRiskLevel, setKycRiskLevel] = useState('low');
    const [loadingInvoice, setLoadingInvoice] = useState(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const { address } = await connectWallet();
            setWalletAddress(address);
            
            const invoicesData = await getBuyerInvoices();
            setInvoices(invoicesData.data);
        } catch (error) {
            console.error('Failed to load data:', error);
        }
    };

    const handlePayInvoice = async (invoice) => {
        // ADD THIS BLOCK FOR DEBUGGING
        console.log("Attempting to pay invoice with this data:", invoice);
        if (!invoice || !ethers.utils.isAddress(invoice.contract_address)) {
            toast.error(`Error: Invalid or missing contract address for this invoice. Address found: ${invoice.contract_address}`);
            return;
        }
        // END ADDED BLOCK

        setLoadingInvoice(invoice.invoice_id);
        try {
            const { signer, address: connectedAddress } = await connectWallet();
            const { amount, currency, contract_address, token_address, invoice_id } = invoice;
            
            const invoiceContract = new ethers.Contract(contract_address, InvoiceContractABI.abi, signer);
            const amountWei = ethers.utils.parseUnits(amount.toString(), 18);
            let tx;

            if (currency === 'MATIC') {
                // --- PRE-FLIGHT CHECKS FOR DEBUGGING NATIVE PAYMENTS ---
                console.log("--- Running Pre-flight Checks for MATIC Payment ---");
                const onChainAmount = await invoiceContract.amount();
                const onChainBuyer = await invoiceContract.buyer();
                const onChainTokenAddress = await invoiceContract.tokenAddress();
                const onChainStatus = await invoiceContract.currentStatus();

                console.log("Connected Wallet (msg.sender):", connectedAddress);
                console.log("On-Chain Expected Buyer:", onChainBuyer);
                console.log("On-Chain Token Address:", onChainTokenAddress, "(Should be AddressZero)");
                console.log("On-Chain Status:", onChainStatus, "(0 = Unpaid)");
                console.log("Amount to Send (Wei):", amountWei.toString());
                console.log("On-Chain Expected Amount (Wei):", onChainAmount.toString());
                
                if (onChainTokenAddress !== ethers.constants.AddressZero) {
                    throw new Error(`Contract expects an ERC20 token, not MATIC. Token Address: ${onChainTokenAddress}`);
                }
                if (onChainAmount.toString() !== amountWei.toString()) {
                    throw new Error(`Amount mismatch. UI wants to send ${amountWei.toString()} but contract expects ${onChainAmount.toString()}`);
                }
                // --- END PRE-FLIGHT CHECKS ---

                tx = await invoiceContract.depositNative({ value: amountWei, gasLimit: 300000 });
            } else {
                const tokenContract = new ethers.Contract(token_address, erc20ABI, signer);
                const approveTx = await tokenContract.approve(contract_address, amountWei);
                await approveTx.wait();
                toast.success('Approval successful! Confirming deposit...');
                tx = await invoiceContract.depositToken();
            }
            
            await tx.wait();
            toast.success(`Payment deposited to escrow! Tx: ${tx.hash}`);
            
            await updateInvoiceStatus(invoice_id, 'deposited', tx.hash);
            loadData();
        } catch (error) {
            console.error('Failed to deposit:', error);
            toast.error(`Deposit failed: ${error.reason || error.message}`);
        } finally {
            setLoadingInvoice(null);
        }
    };

    const handleReleaseFunds = async (invoice) => {
        if (!window.confirm("Are you sure you want to release the funds to the seller? This action cannot be undone.")) {
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
            loadData();
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
            loadData();
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

    const escrowInvoices = invoices.filter(inv => ['deposited', 'disputed'].includes(inv.escrow_status));

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
                {console.log("Sliced Invoices",invoices.slice(0,5))}
                <InvoiceList
                  invoices={invoices.slice(0, 5)}
                  onSelectInvoice={handleSelectInvoice}
                  onPayInvoice={handlePayInvoice}
                  onConfirmRelease={handleReleaseFunds}
                  onRaiseDispute={handleRaiseDispute}
                  userRole="buyer"
                />
              </div>
              
              <div>
                <h3 className="text-xl font-semibold mb-4">KYC Status</h3>
                <KYCStatus
                  status={kycStatus}
                  riskLevel={kycRiskLevel}
                  details="Your identity has been verified successfully."
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
              onSelectInvoice={handleSelectInvoice}
              onPayInvoice={handlePayInvoice}
              onConfirmRelease={handleReleaseFunds}
              onRaiseDispute={handleRaiseDispute}
              userRole="buyer"
            />
          </div>
        );
      
      case 'payments':
        return (
          <div>
            <h2 className="text-2xl font-bold mb-6">Payment History</h2>
            <div className="bg-white rounded-lg shadow-md p-6">
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
                      onSelectInvoice={handleSelectInvoice}
                      onConfirmRelease={handleReleaseFunds}
                      onRaiseDispute={handleRaiseDispute}
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
      {renderTabContent()}
    </div>
  );
};

export default BuyerDashboard;