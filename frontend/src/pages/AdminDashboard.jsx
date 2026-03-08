import React, { useState, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import AnalyticsPage from './AnalyticsPage';
import {
  getUsers,
  getInvoices,
  freezeAccount,
  unfreezeAccount,
  updateUserRole,
  checkCompliance,
  resolveDispute
} from '../utils/api';
import StatsCard from '../components/Dashboard/StatsCard';
import InvoiceList from '../components/Invoice/InvoiceList';
import { toast } from 'sonner';
import { useStatsActions } from '../context/StatsContext';

// Loading Spinner Component
const LoadingSpinner = () => (
  <div className="flex items-center justify-center py-12">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" role="status">
      <span className="sr-only">Loading...</span>
    </div>
  </div>
);

// Empty State Component
const EmptyState = ({ message = "No data available" }) => (
  <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
    <p>{message}</p>
  </div>
);

// Button Component for consistent styling
const ActionButton = ({ onClick, children, variant = 'primary', disabled = false, className = '' }) => {
  const baseClasses = "px-3 py-1.5 rounded text-sm font-medium transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    danger: "bg-red-600 text-white hover:bg-red-700",
    success: "bg-green-600 text-white hover:bg-green-700",
    secondary: "bg-gray-200 text-gray-800 hover:bg-gray-300",
  };
  
  return (
    <button 
      onClick={onClick} 
      disabled={disabled}
      className={`${baseClasses} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

ActionButton.propTypes = {
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(['primary', 'danger', 'success', 'secondary']),
  disabled: PropTypes.bool,
  className: PropTypes.string,
};

const AdminDashboard = ({ activeTab = 'overview' }) => {
  const [users, setUsers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [walletToCheck, setWalletToCheck] = useState('');
  const [complianceResult, setComplianceResult] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const { setStats: setGlobalStats } = useStatsActions();

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [usersResponse, invoicesResponse] = await Promise.all([
        getUsers(),
        getInvoices()
      ]);
      
      setUsers(Array.isArray(usersResponse?.data?.data) ? usersResponse.data.data : []);
      setInvoices(Array.isArray(invoicesResponse?.data?.data) ? invoicesResponse.data.data : []);
    } catch (error) {
      console.error('Failed to load admin data:', error);
      toast.error("Failed to load admin data. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Memoized calculations
  const disputedInvoices = useMemo(() => 
    invoices.filter(inv => inv.escrow_status === 'disputed'),
    [invoices]
  );

  const activeEscrowsCount = useMemo(() => 
    invoices.filter(inv => ['deposited', 'shipped'].includes(inv.escrow_status)).length,
    [invoices]
  );

  const completedCount = useMemo(() => 
    invoices.filter(inv => inv.escrow_status === 'released').length,
    [invoices]
  );

  const stats = useMemo(() => [
    { title: 'Total Users', value: String(users.length), change: 5, icon: '👥', color: 'blue' },
    { title: 'Total Invoices', value: String(invoices.length), change: 12, icon: '📝', color: 'green' },
    { title: 'Active Escrows', value: String(activeEscrowsCount), change: -3, icon: '🔒', color: 'purple' },
    { title: 'Disputes', value: String(disputedInvoices.length), change: 0, icon: '⚖️', color: 'orange' },
  ], [users.length, invoices.length, activeEscrowsCount, disputedInvoices.length]);

  useEffect(() => {
    setGlobalStats({
      totalInvoices: invoices.length,
      activeEscrows: activeEscrowsCount,
      completed: completedCount,
      produceLots: 0
    });
  }, [invoices.length, activeEscrowsCount, completedCount, setGlobalStats]);

  // Handlers with optimistic updates and proper error handling
  const handleFreezeToggle = useCallback(async (userId, isFrozen) => {
    try {
      if (isFrozen) {
        await unfreezeAccount(userId);
        toast.success('Account unfrozen successfully');
      } else {
        if (!window.confirm('Are you sure you want to freeze this account?')) return;
        await freezeAccount(userId);
        toast.success('Account frozen successfully');
      }
      loadData();
    } catch (error) {
      console.error('Failed to toggle account freeze:', error);
      toast.error(`Failed to ${isFrozen ? 'unfreeze' : 'freeze'} account.`);
    }
  }, [loadData]);

  const handleUpdateUserRole = useCallback(async (userId, newRole) => {
    try {
      await updateUserRole(userId, newRole);
      toast.success('User role updated successfully');
      loadData();
    } catch (error) {
      console.error('Failed to update user role:', error);
      toast.error('Failed to update user role.');
    }
  }, [loadData]);

  const handleCheckCompliance = useCallback(async () => {
    if (!walletToCheck.trim()) {
      toast.error('Please enter a wallet address');
      return;
    }
    
    try {
      const result = await checkCompliance(walletToCheck);
      setComplianceResult(result.data);
      toast.success('Compliance check completed');
    } catch (error) {
      console.error('Failed to check compliance:', error);
      toast.error('Failed to check compliance.');
      setComplianceResult(null);
    }
  }, [walletToCheck]);

  const handleResolveDispute = useCallback(async (invoiceId, sellerWins) => {
    if (!window.confirm(`Are you sure you want to resolve this dispute in favor of the ${sellerWins ? 'seller' : 'buyer'}?`)) {
      return;
    }
    
    setIsResolving(true);
    try {
      await resolveDispute(invoiceId, sellerWins);
      toast.success(`Dispute resolved in favor of ${sellerWins ? 'seller' : 'buyer'}`);
      loadData();
    } catch (error) {
      console.error('Failed to resolve dispute:', error);
      toast.error('Failed to resolve dispute.');
    } finally {
      setIsResolving(false);
    }
  }, [loadData]);

  // Tab Components
  const OverviewTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Overview</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <StatsCard key={`${stat.title}-${index}`} {...stat} />
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">Recent Invoices</h3>
        </div>
        <div className="p-6">
          {invoices.length > 0 ? (
            <InvoiceList
              invoices={invoices.slice(0, 10)}
              onSelectInvoice={setSelectedInvoice}
            />
          ) : (
            <EmptyState message="No recent invoices" />
          )}
        </div>
      </div>
    </div>
  );

  const InvoicesTab = () => (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
        <h2 className="text-xl font-bold text-gray-800">All Invoices</h2>
        <span className="text-sm text-gray-500">{invoices.length} total</span>
      </div>
      <div className="p-6">
        {invoices.length > 0 ? (
          <InvoiceList
            invoices={invoices}
            onSelectInvoice={setSelectedInvoice}
          />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );

  const UserManagementSection = () => (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800">User Management</h3>
      </div>
      
      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Wallet</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">KYC Status</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {users.map(user => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.email}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono truncate max-w-xs" title={user.wallet_address}>
                  {user.wallet_address?.slice(0, 6)}...{user.wallet_address?.slice(-4)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    user.kyc_status === 'verified' ? 'bg-green-100 text-green-800' : 
                    user.kyc_status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 
                    'bg-red-100 text-red-800'
                  }`}>
                    {user.kyc_status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                  <ActionButton
                    onClick={() => handleFreezeToggle(user.id, user.is_frozen)}
                    variant={user.is_frozen ? 'success' : 'danger'}
                  >
                    {user.is_frozen ? 'Unfreeze' : 'Freeze'}
                  </ActionButton>
                  
                  <select 
                    onChange={(e) => handleUpdateUserRole(user.id, e.target.value)} 
                    defaultValue={user.role}
                    className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    aria-label="Change user role"
                  >
                    <option value="seller">Seller</option>
                    <option value="buyer">Buyer</option>
                    <option value="admin">Admin</option>
                    <option value="shipment">Shipment</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden p-4 space-y-4">
        {users.map(user => (
          <div key={user.id} className="bg-white border rounded-lg p-4 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <span className="font-medium text-gray-900 truncate max-w-[200px]">{user.email}</span>
              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                  user.kyc_status === 'verified' ? 'bg-green-100 text-green-800' : 
                  user.kyc_status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 
                  'bg-red-100 text-red-800'
                }`}>
                  {user.kyc_status}
              </span>
            </div>
            
            <div className="text-xs text-gray-500 font-mono mb-4 break-all">
              {user.wallet_address}
            </div>

            <div className="flex flex-col gap-2">
               <div className="flex justify-between items-center gap-2">
                  <ActionButton
                    onClick={() => handleFreezeToggle(user.id, user.is_frozen)}
                    variant={user.is_frozen ? 'success' : 'danger'}
                    className="flex-1 text-center justify-center"
                  >
                    {user.is_frozen ? 'Unfreeze' : 'Freeze'}
                  </ActionButton>
                  
                  <select 
                    onChange={(e) => handleUpdateUserRole(user.id, e.target.value)} 
                    defaultValue={user.role}
                    className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    aria-label="Change user role"
                  >
                    <option value="seller">Seller</option>
                    <option value="buyer">Buyer</option>
                    <option value="admin">Admin</option>
                    <option value="shipment">Shipment</option>
                  </select>
               </div>
            </div>
          </div>
        ))}
      </div>
      
      {users.length === 0 && <EmptyState message="No users found" />}
    </div>
  );

  const ComplianceSection = () => (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Compliance Check</h3>
      <div className="space-y-4">
        <div className="flex gap-2">
          <input 
            type="text" 
            placeholder="Enter wallet address (0x...)" 
            value={walletToCheck} 
            onChange={(e) => setWalletToCheck(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleCheckCompliance()}
            className="flex-1 border border-gray-300 px-4 py-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            aria-label="Wallet address to check"
          />
          <ActionButton onClick={handleCheckCompliance} variant="primary">
            Check
          </ActionButton>
        </div>
        
        {complianceResult && (
          <div className={`p-4 rounded-lg border ${
            complianceResult.compliant ? 
            'bg-green-50 border-green-200 text-green-800' : 
            'bg-red-50 border-red-200 text-red-800'
          }`} role="status" aria-live="polite">
            <p className="font-semibold">
              Status: {complianceResult.compliant ? '✅ Compliant' : '❌ Non-Compliant'}
            </p>
            {!complianceResult.compliant && complianceResult.reason && (
              <p className="mt-1 text-sm">Reason: {complianceResult.reason}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const DisputeResolutionSection = () => (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800">Dispute Resolution</h3>
      </div>
      
      {disputedInvoices.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice ID</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {disputedInvoices.map(invoice => (
                <tr key={invoice.invoice_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900" title={invoice.invoice_id}>
                    {invoice.invoice_id?.slice(0, 8)}...
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                    {invoice.amount}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                    {invoice.dispute_reason}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                    <ActionButton 
                      onClick={() => handleResolveDispute(invoice.invoice_id, true)}
                      variant="success"
                      disabled={isResolving}
                      className="text-xs"
                    >
                      Seller Wins
                    </ActionButton>
                    <ActionButton 
                      onClick={() => handleResolveDispute(invoice.invoice_id, false)}
                      variant="danger"
                      disabled={isResolving}
                      className="text-xs"
                    >
                      Buyer Wins
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState message="No active disputes" />
      )}
    </div>
  );

  const AdminTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Administration</h2>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <UserManagementSection />
        <ComplianceSection />
        <div className="xl:col-span-2">
          <DisputeResolutionSection />
        </div>
      </div>
    </div>
  );

  const PlaceholderTab = () => (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
      <h2 className="text-2xl font-bold text-gray-800 mb-2 capitalize">{activeTab}</h2>
      <p className="text-gray-500">This section is under construction.</p>
    </div>
  );

  const renderTabContent = () => {
    if (isLoading) return <LoadingSpinner />;
    
    switch (activeTab) {
      case 'overview': return <OverviewTab />;
      case 'invoices': return <InvoicesTab />;
      case 'admin': return <AdminTab />;
      case 'payments':
      case 'escrow': return <PlaceholderTab />;
      case 'analytics': return <AnalyticsPage activeTab={activeTab} />;
      default: return <PlaceholderTab />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">Manage users, invoices, and disputes</p>
        </header>
        
        <main className="animate-fadeIn">
          {renderTabContent()}
        </main>
      </div>
      
      {/* Debug/Selected Info (optional) */}
      {selectedInvoice && (
        <div className="fixed bottom-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">
          Selected Invoice: {selectedInvoice.invoice_id?.slice(0, 8)}...
          <button 
            onClick={() => setSelectedInvoice(null)} 
            className="ml-2 font-bold hover:text-blue-200"
            aria-label="Clear selection"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
};

AdminDashboard.propTypes = {
  activeTab: PropTypes.string
};

export default AdminDashboard;