import React, { useState, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { toast } from 'sonner';
import { getSellerInvoices, getKYCStatus, getSellerLots, getQuotations } from '../utils/api';
import { connectWallet } from '../utils/web3';
import { useStatsActions } from '../context/StatsContext';

// Components
import ExportTransactions from '../components/ExportTransactions'; // ✅ Import Feature
import StatsCard from '../components/Dashboard/StatsCard';
import InvoiceList from '../components/Invoice/InvoiceList';
import KYCStatus from '../components/KYC/KYCStatus';
import PaymentHistoryList from '../components/Dashboard/PaymentHistoryList';
import EscrowStatus from '../components/Escrow/EscrowStatus';
import EscrowTimeline from '../components/Escrow/EscrowTimeline';

const LoadingSpinner = () => (
  <div className="flex justify-center py-20">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>
);

const SellerDashboard = ({ activeTab = 'overview' }) => {
  const [invoices, setInvoices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [walletAddress, setWalletAddress] = useState('');
  const [kycData, setKycData] = useState({ status: 'not_started', riskLevel: 'unknown', details: 'Pending' });
  const { setStats: setGlobalStats } = useStatsActions();

  // Load Real Data
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const { address } = await connectWallet();
      setWalletAddress(address);

      const [invoicesData, kycRes] = await Promise.all([
        getSellerInvoices(),
        getKYCStatus().catch(() => ({ data: {} }))
      ]);

      setInvoices(invoicesData.data || []);
      setKycData({
        status: kycRes.data?.status || 'not_started',
        riskLevel: kycRes.data?.kyc_risk_level || 'unknown',
        details: kycRes.data?.details || 'Pending verification'
      });

    } catch (error) {
      console.error("Dashboard Load Error:", error);
      toast.error("Failed to load dashboard data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Update Global Stats
  useEffect(() => {
    setGlobalStats({ totalInvoices: invoices.length });
  }, [invoices, setGlobalStats]);

  // Derived Stats
  const stats = useMemo(() => [
    { title: 'Pending', value: invoices.filter(i => i.status === 'pending').length, icon: '📝', color: 'blue' },
    { title: 'Active Escrows', value: invoices.filter(i => ['deposited', 'shipped'].includes(i.escrow_status)).length, icon: '🔒', color: 'green' },
    { title: 'Completed', value: invoices.filter(i => i.escrow_status === 'released').length, icon: '✅', color: 'purple' },
    { title: 'Disputed', value: invoices.filter(i => i.escrow_status === 'disputed').length, icon: '⚖️', color: 'red' },
  ], [invoices]);

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Seller Dashboard</h1>
        </header>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {stats.map((s, i) => <StatsCard key={i} {...s} />)}
            </div>
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
               <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold">Recent Invoices</h3>
                  {/* ✅ Export Buttons visible on Overview */}
                  {invoices.length > 0 && <ExportTransactions invoices={invoices} />}
               </div>
               <InvoiceList invoices={invoices.slice(0, 5)} userRole="seller" />
            </div>
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
               <h3 className="text-lg font-semibold mb-4">KYC Status</h3>
               <KYCStatus status={kycData.status} riskLevel={kycData.riskLevel} details={kycData.details} />
            </div>
          </div>
        )}

        {activeTab === 'invoices' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
             <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">All Invoices</h2>
                {/* ✅ Export Buttons visible on Invoices Tab */}
                {invoices.length > 0 && <ExportTransactions invoices={invoices} />}
             </div>
             <InvoiceList invoices={invoices} userRole="seller" />
          </div>
        )}

        {/* Other tabs can be added back here as needed */}
      </div>
    </div>
  );
};

SellerDashboard.propTypes = { activeTab: PropTypes.string };
export default SellerDashboard;