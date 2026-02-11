import React, { useState, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { toast } from 'sonner';
import { getSellerInvoices, getKYCStatus } from '../utils/api';
import { connectWallet } from '../utils/web3';
import { useStatsActions } from '../context/StatsContext';

// Components
import ExportTransactions from '../components/ExportTransactions';
import StatsCard from '../components/Dashboard/StatsCard';
import InvoiceList from '../components/Invoice/InvoiceList';
import KYCStatus from '../components/KYC/KYCStatus';

// ------------------ UI HELPERS ------------------

const LoadingSpinner = () => (
  <div className="flex justify-center py-20">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
  </div>
);

// ------------------ MAIN COMPONENT ------------------

const SellerDashboard = ({ activeTab = 'overview' }) => {
  const [invoices, setInvoices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [walletAddress, setWalletAddress] = useState('');
  const [kycData, setKycData] = useState({
    status: 'not_started',
    riskLevel: 'unknown',
    details: 'Pending'
  });

  const { setStats: setGlobalStats } = useStatsActions();

  // ------------------ LOAD DATA ------------------

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);

      const { address } = await connectWallet();
      setWalletAddress(address);

      const [invoiceRes, kycRes] = await Promise.all([
        getSellerInvoices(),
        getKYCStatus().catch(() => ({ data: {} }))
      ]);

      setInvoices(invoiceRes?.data || []);
      setKycData({
        status: kycRes?.data?.status || 'not_started',
        riskLevel: kycRes?.data?.kyc_risk_level || 'unknown',
        details: kycRes?.data?.details || 'Pending verification'
      });

    } catch (err) {
      console.error('Dashboard load failed:', err);
      toast.error('Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ------------------ GLOBAL STATS ------------------

  useEffect(() => {
    setGlobalStats({ totalInvoices: invoices.length });
  }, [invoices, setGlobalStats]);

  // ------------------ DERIVED STATS ------------------

  const stats = useMemo(() => [
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
  ], [invoices]);

  if (isLoading) return <LoadingSpinner />;

  // ------------------ RENDER ------------------

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        <header>
          <h1 className="text-3xl font-bold text-gray-900">
            Seller Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Wallet: {walletAddress}
          </p>
        </header>

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
              <KYCStatus
                status={kycData.status}
                riskLevel={kycData.riskLevel}
                details={kycData.details}
              />
            </div>
          </>
        )}

        {activeTab === 'invoices' && (
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">All Invoices</h2>
              {invoices.length > 0 && (
                <ExportTransactions invoices={invoices} />
              )}
            </div>
            <InvoiceList invoices={invoices} userRole="seller" />
          </div>
        )}
      </div>
    </div>
  );
};

SellerDashboard.propTypes = {
  activeTab: PropTypes.string
};

export default SellerDashboard;