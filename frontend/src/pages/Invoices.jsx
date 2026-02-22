import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Link } from 'react-router-dom';

// Timeline Component
const Timeline = ({ status }) => {
  const steps = ["CREATED", "PAYMENT_PENDING", "ESCROW_LOCKED", "RELEASED"];

  // Mapping statuses to steps
  let currentStepIndex = -1;
  if (status === 'CREATED') currentStepIndex = 0;
  if (status === 'PAYMENT_PENDING') currentStepIndex = 1;
  if (status === 'ESCROW_LOCKED') currentStepIndex = 2;
  if (status === 'RELEASED' || status === 'SETTLED') currentStepIndex = 3;

  const isError = ['DISPUTED', 'CANCELLED', 'FAILED'].includes(status);

  if (isError) {
      return <div className="text-red-600 font-bold text-xs">{status}</div>;
  }

  return (
    <div className="flex items-center space-x-1 text-xs">
      {steps.map((step, i) => (
        <div key={step} className={`flex items-center ${i <= currentStepIndex ? "text-green-600 font-bold" : "text-gray-400"}`}>
          <span>{step === 'ESCROW_LOCKED' ? 'ESCROW' : step === 'PAYMENT_PENDING' ? 'PENDING' : step}</span>
          {i < steps.length - 1 && <span className="mx-1 text-gray-300">→</span>}
        </div>
      ))}
    </div>
  );
};

const StatusBadge = ({ status }) => {
    const colors = {
        CREATED: 'bg-gray-100 text-gray-800',
        PAYMENT_PENDING: 'bg-yellow-100 text-yellow-800',
        ESCROW_LOCKED: 'bg-blue-100 text-blue-800',
        RELEASED: 'bg-green-100 text-green-800',
        SETTLED: 'bg-green-100 text-green-800',
        DISPUTED: 'bg-red-100 text-red-800',
        CANCELLED: 'bg-red-100 text-red-800',
        FAILED: 'bg-red-100 text-red-800',
    };
    return (
        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${colors[status] || 'bg-gray-100'}`}>
            {status}
        </span>
    );
};

const Invoices = () => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const [syncing, setSyncing] = useState(null);

  // Get user safely
  const userStr = localStorage.getItem('user');
  const user = userStr ? JSON.parse(userStr) : null;

  const fetchInvoices = async () => {
    if (!user) return;
    try {
      let endpoint = '/invoices/seller';
      if (user.role === 'buyer') endpoint = '/invoices/buyer';
      // Fallback or specific logic for other roles

      const res = await api.get(endpoint);
      setInvoices(res.data);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
    const interval = setInterval(fetchInvoices, 10000); // Polling every 10s
    return () => clearInterval(interval);
  }, []);

  const handleSync = async (id) => {
      setSyncing(id);
      try {
          await api.post(`/invoices/${id}/sync`);
          await fetchInvoices();
      } catch (err) {
          console.error(err);
      } finally {
          setSyncing(null);
      }
  };

  const filteredInvoices = invoices.filter(inv => {
      if (filter === 'All') return true;
      if (filter === 'Pending') return ['CREATED', 'PAYMENT_PENDING'].includes(inv.status);
      if (filter === 'Active') return ['ESCROW_LOCKED'].includes(inv.status);
      if (filter === 'Completed') return ['RELEASED', 'SETTLED'].includes(inv.status);
      return true;
  });

  if (!user) {
      return <div className="p-6 text-center">Please log in to view invoices.</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fadeIn">
      <div className="flex justify-between items-center mb-6">
        <div>
            <h1 className="text-2xl font-bold text-gray-900">Invoices Dashboard</h1>
            <p className="text-gray-500 text-sm mt-1">Real-time status tracking</p>
        </div>
        <button
            onClick={() => fetchInvoices()}
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
        >
            ↻ Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex space-x-2 mb-6 overflow-x-auto pb-2">
          {['All', 'Pending', 'Active', 'Completed'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    filter === f
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                  {f}
              </button>
          ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timeline</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {loading ? (
                        [1,2,3].map(i => (
                            <tr key={i} className="animate-pulse">
                                <td colSpan="5" className="px-6 py-4">
                                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                                </td>
                            </tr>
                        ))
                    ) : filteredInvoices.length > 0 ? (
                        filteredInvoices.map(inv => (
                        <tr key={inv.invoice_id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                                #{inv.invoice_id.substring(0, 8)}...
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                                {inv.amount} {inv.currency}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                                <StatusBadge status={inv.status} />
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                                <Timeline status={inv.status} />
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium flex items-center gap-3">
                                <button
                                    onClick={() => handleSync(inv.invoice_id)}
                                    disabled={syncing === inv.invoice_id}
                                    className={`text-blue-600 hover:text-blue-900 ${syncing === inv.invoice_id ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {syncing === inv.invoice_id ? 'Syncing...' : 'Sync Status'}
                                </button>
                                {(inv.tx_hash || inv.invoice_hash) && (
                                    <a
                                        href={`https://amoy.polygonscan.com/tx/${inv.tx_hash || inv.invoice_hash}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-gray-400 hover:text-blue-600 transition-colors"
                                        title="View on Explorer"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                        </svg>
                                    </a>
                                )}
                            </td>
                        </tr>
                    ))
                    ) : (
                        <tr>
                            <td colSpan="5" className="text-center py-12 text-gray-500">
                                <p className="text-lg mb-1">📭</p>
                                <p>No invoices found</p>
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};

export default Invoices;
