import React, { useState, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { toast } from 'sonner';

import {
  getSellerInvoices,
  getSellerLots,
  getQuotations,
  getKYCStatus
} from '../utils/api';

import { connectWallet } from '../utils/web3';
import socket from '../utils/socket';

import { useStatsActions } from '../context/StatsContext';

import ExportTransactions from '../components/ExportTransactions';
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

// ------------------ MAIN COMPONENT ------------------

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
    if (!walletAddress) return;

    const handleEscrowRelease = () => {
      toast.success('Escrow released');
      loadInvoices();
    };

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

  if (isLoading) return <LoadingSpinner />;

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
            <InvoiceList invoices={invoices} userRole="seller" />
          </div>
        )}
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