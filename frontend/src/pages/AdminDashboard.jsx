import React, { useState, useEffect } from 'react';
import {
  getUsers,
  getInvoices,
  freezeAccount,
  unfreezeAccount,
  updateUserRole,
  checkCompliance
} from '../utils/api';
import StatsCard from '../components/Dashboard/StatsCard';
import InvoiceList from '../components/Invoice/InvoiceList';

// FIX: Accept activeTab as a prop
const AdminDashboard = ({ activeTab }) => {
  const [users, setUsers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [walletToCheck, setWalletToCheck] = useState('');
  const [complianceResult, setComplianceResult] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const usersData = await getUsers();
      const invoicesData = await getInvoices();
      setUsers(usersData.data);
      setInvoices(invoicesData.data);
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  const handleFreezeAccount = async (userId) => {
    try {
      await freezeAccount(userId);
      alert('Account frozen successfully');
      loadData();
    } catch (error) {
      console.error('Failed to freeze account:', error);
    }
  };

  const handleUnfreezeAccount = async (userId) => {
    try {
      await unfreezeAccount(userId);
      alert('Account unfrozen successfully');
      loadData();
    } catch (error) {
      console.error('Failed to unfreeze account:', error);
    }
  };

  const handleCheckCompliance = async () => {
    try {
      const result = await checkCompliance(walletToCheck);
      setComplianceResult(result.data);
    } catch (error) {
      console.error('Failed to check compliance:', error);
    }
  };

  const handleUpdateUserRole = async (userId, role) => {
    try {
      await updateUserRole(userId, role);
      alert('User role updated successfully');
      loadData();
    } catch (error) {
      console.error('Failed to update user role:', error);
    }
  };

  const stats = [
    { title: 'Total Users', value: users.length.toString(), change: 5, icon: '👥', color: 'blue' },
    { title: 'Total Invoices', value: invoices.length.toString(), change: 12, icon: '📝', color: 'green' },
    { title: 'Active Escrows', value: '8', change: -3, icon: '🔒', color: 'purple' },
    { title: 'Disputes', value: '2', change: 0, icon: '⚖️', color: 'orange' },
  ];

  // FIX: Create a function to render content based on the active tab
  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div>
            <h2 className="text-2xl font-bold mb-6">Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {stats.map((stat, index) => (
                <StatsCard key={index} {...stat} />
              ))}
            </div>
            <div className="bg-white p-4 rounded shadow">
              <h3 className="text-xl font-semibold mb-4">Recent Invoices</h3>
              <InvoiceList
                invoices={invoices.slice(0, 10)}
                onSelectInvoice={(invoice) => setSelectedUser(invoice)}
              />
            </div>
          </div>
        );

      case 'invoices':
        return (
          <div>
            <h2 className="text-2xl font-bold mb-6">All Invoices</h2>
            <div className="bg-white p-4 rounded shadow">
              <InvoiceList
                invoices={invoices}
                onSelectInvoice={(invoice) => setSelectedUser(invoice)}
              />
            </div>
          </div>
        );

      case 'admin':
        return (
          <div>
            <h2 className="text-2xl font-bold mb-6">Administration</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* User Management */}
              <div className="bg-white p-4 rounded shadow">
                <h3 className="text-xl font-semibold mb-4">User Management</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full table-auto">
                    <thead>
                      <tr>
                        <th className="px-4 py-2">Email</th>
                        <th className="px-4 py-2">Wallet</th>
                        <th className="px-4 py-2">KYC Status</th>
                        <th className="px-4 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(user => (
                        <tr key={user.id}>
                          <td className="border px-4 py-2">{user.email}</td>
                          <td className="border px-4 py-2 truncate max-w-xs">{user.wallet_address}</td>
                          <td className="border px-4 py-2">{user.kyc_status}</td>
                          <td className="border px-4 py-2">
                            {user.is_frozen ? (
                              <button onClick={() => handleUnfreezeAccount(user.id)} className="bg-green-500 text-white px-2 py-1 rounded mr-1">Unfreeze</button>
                            ) : (
                              <button onClick={() => handleFreezeAccount(user.id)} className="bg-red-500 text-white px-2 py-1 rounded mr-1">Freeze</button>
                            )}
                            <select onChange={(e) => handleUpdateUserRole(user.id, e.target.value)} defaultValue={user.role} className="border rounded px-2 py-1">
                              <option value="seller">Seller</option>
                              <option value="buyer">Buyer</option>
                              <option value="admin">Admin</option>
                              <option value="arbitrator">Arbitrator</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Compliance Check */}
              <div className="bg-white p-4 rounded shadow">
                <h3 className="text-xl font-semibold mb-4">Compliance Check</h3>
                <div className="mb-4">
                  <input type="text" placeholder="Wallet address to check" value={walletToCheck} onChange={(e) => setWalletToCheck(e.target.value)} className="border p-2 w-full rounded" />
                  <button onClick={handleCheckCompliance} className="bg-blue-500 text-white px-4 py-2 rounded mt-2">Check Compliance</button>
                </div>
                {complianceResult && (
                  <div className={`p-3 rounded ${complianceResult.compliant ? 'bg-green-100' : 'bg-red-100'}`}>
                    <p>Compliant: {complianceResult.compliant ? 'Yes' : 'No'}</p>
                    {!complianceResult.compliant && <p>Reason: {complianceResult.reason}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      // Add placeholder cases for other tabs from the sidebar
      case 'payments':
      case 'escrow':
        return (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold mb-4 capitalize">{activeTab}</h2>
            <p className="text-gray-600">This section is under construction for the Admin view.</p>
          </div>
        );
        
      default:
        return <div>Select a section from the sidebar.</div>;
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>
      {/* FIX: Call the new render function */}
      {renderTabContent()}
    </div>
  );
};

export default AdminDashboard;