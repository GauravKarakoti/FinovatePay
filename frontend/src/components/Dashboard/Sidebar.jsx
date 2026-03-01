import React from 'react';
import { useStats } from '../../context/StatsContext';
import { updateCurrentUserRole } from '../../utils/api';
import { disconnectWallet } from '../../utils/web3';
import { useNavigate, useLocation } from 'react-router-dom';

const Sidebar = ({ activeTab, onTabChange, user, walletConnected, onLogout, onClose }) => {
  const { stats } = useStats();

  const handleRoleSwitch = async (newRole) => {
    try {
      const response = await updateCurrentUserRole(newRole);
      if (response && response.data.user) {
        localStorage.setItem('user', JSON.stringify(response.data.user));
        
        // Navigate to the appropriate dashboard based on new role
        const dashboardRoutes = {
          buyer: '/buyer',
          seller: '/',
          admin: '/admin',
          investor: '/investor',
          shipment: '/shipment',
          warehouse: '/shipment'
        };
        
        const targetRoute = dashboardRoutes[newRole] || '/';
        navigate(targetRoute);
        
        // Force a re-render by updating the page
        window.location.href = targetRoute;
      }
    } catch (error) {
      console.error('Failed to switch role:', error);
    }
  };

  const handleWalletDisconnect = async () => {
    await disconnectWallet();
    window.location.reload();
  };
  const navigate = useNavigate();
  const location = useLocation();

const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'quotations', label: 'Quotations', icon: '💬' },
    { id: 'invoices', label: 'Invoices', icon: '📝' },
    { id: 'produce', label: 'Produce', icon: '🌱' }, // Add this tab
    { id: 'payments', label: 'Payments', icon: '💳' },
    { id: 'escrow', label: 'Escrow', icon: '🔒' },
  ];

  // Add Analytics tab for admin, seller, investor roles
  if (['admin', 'seller', 'investor'].includes(user?.role)) {
    tabs.push({ id: 'analytics', label: 'Analytics', icon: '📈' });
  }

  // Add Streaming Payments tab for seller role
  if (user?.role === 'seller') {
    tabs.push({ id: 'streaming', label: 'Streaming', icon: '📺' });
  }
  const displayStats = stats || { totalInvoices: 0, activeEscrows: 0, completed: 0 };

  // Add Financing tab for relevant roles
  if (user?.role === 'seller' || user?.role === 'investor' || user?.role === 'admin') {
    tabs.push({ id: 'financing', label: 'Financing', icon: '💸' });
  }

  // Add Auctions tab for investor and seller roles
  if (user?.role === 'investor' || user?.role === 'seller' || user?.role === 'admin') {
    tabs.push({ id: 'auctions', label: 'Auctions', icon: '🏷️' });
  }

  if (user?.role === 'admin') {
    tabs.push({ id: 'admin', label: 'Admin', icon: '⚙️' });
  }

  const visibleTabs = user?.role === 'investor' ? tabs.filter(tab => !['quotations', 'invoices', 'payments', 'produce', 'escrow'].includes(tab.id)) : tabs;

  const isInvoicesPage = location.pathname === '/invoices';
  // If on invoices page, force activeTab to 'invoices' regardless of prop
  const currentTab = isInvoicesPage ? 'invoices' : activeTab;

  const handleTabClick = (tabId) => {
    if (tabId === 'invoices') {
      navigate('/invoices');
      onTabChange('invoices');
    } else {
      // Determine dashboard root based on role
      let dashboardPath = '/';
      if (user?.role === 'buyer') dashboardPath = '/buyer';
      if (user?.role === 'admin') dashboardPath = '/admin';
      if (user?.role === 'investor') dashboardPath = '/investor';
      if (user?.role === 'shipment' || user?.role === 'warehouse') dashboardPath = '/shipment';

      if (isInvoicesPage) {
          navigate(dashboardPath);
      }
      onTabChange(tabId);
    }
  };

  return (
    <div className="bg-white shadow-md rounded-lg p-4 h-full md:h-fit flex flex-col overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Navigation</h2>
        <button
          onClick={onClose}
          className="md:hidden text-gray-500 hover:text-gray-700 focus:outline-none p-2"
          aria-label="Close Sidebar"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <ul className="space-y-2 flex-grow">
        {visibleTabs.map(tab => (
          <li key={tab.id}>
            <button
              onClick={() => handleTabClick(tab.id)}
              className={`w-full text-left px-4 py-2 rounded-md transition-colors flex items-center space-x-2 ${
                currentTab === tab.id
                  ? 'bg-finovate-blue-100 text-finovate-blue-800 font-medium'
                  : 'hover:bg-gray-100'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-8 p-4 bg-finovate-blue-50 rounded-md">
          <h3 className="font-medium text-finovate-blue-800">Quick Stats</h3>
          <div className="mt-2 space-y-2 text-sm">
              {/* Use dynamic data from props */}
              <div className="flex justify-between">
                  <span>Total Invoices:</span>
                  <span className="font-medium">{displayStats.totalInvoices}</span>
              </div>
              <div className="flex justify-between">
                  <span>Active Escrows:</span>
                  <span className="font-medium">{displayStats.activeEscrows}</span>
              </div>
              <div className="flex justify-between">
                  <span>Completed:</span>
                  <span className="font-medium">{displayStats.completed}</span>
              </div>
          </div>
      </div>

      {/* Mobile Account Actions */}
      <div className="mt-8 md:hidden border-t pt-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Account</h3>

        {user?.role !== 'admin' && (
           <div className="flex flex-col space-y-2 mb-4">
             {user.role === 'buyer' ? <>
                 <button onClick={() => handleRoleSwitch('seller')} className="w-full text-left px-4 py-2 rounded-md bg-green-50 text-green-700 hover:bg-green-100 font-medium">Switch to Seller</button>
                 <button onClick={() => handleRoleSwitch('shipment')} className="w-full text-left px-4 py-2 rounded-md bg-orange-50 text-orange-700 hover:bg-orange-100 font-medium">Switch to Shipment</button>
                 <button onClick={() => handleRoleSwitch('investor')} className="w-full text-left px-4 py-2 rounded-md bg-gray-50 text-gray-700 hover:bg-gray-100 font-medium">Switch to Investor</button>
             </> : user.role === 'seller' ? <>
                 <button onClick={() => handleRoleSwitch('buyer')} className="w-full text-left px-4 py-2 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium">Switch to Buyer</button>
                 <button onClick={() => handleRoleSwitch('shipment')} className="w-full text-left px-4 py-2 rounded-md bg-orange-50 text-orange-700 hover:bg-orange-100 font-medium">Switch to Shipment</button>
                 <button onClick={() => handleRoleSwitch('investor')} className="w-full text-left px-4 py-2 rounded-md bg-gray-50 text-gray-700 hover:bg-gray-100 font-medium">Switch to Investor</button>
             </> : user.role === 'shipment' ? <>
                 <button onClick={() => handleRoleSwitch('buyer')} className="w-full text-left px-4 py-2 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium">Switch to Buyer</button>
                 <button onClick={() => handleRoleSwitch('seller')} className="w-full text-left px-4 py-2 rounded-md bg-green-50 text-green-700 hover:bg-green-100 font-medium">Switch to Seller</button>
                 <button onClick={() => handleRoleSwitch('investor')} className="w-full text-left px-4 py-2 rounded-md bg-gray-50 text-gray-700 hover:bg-gray-100 font-medium">Switch to Investor</button>
             </> : <>
                 <button onClick={() => handleRoleSwitch('buyer')} className="w-full text-left px-4 py-2 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium">Switch to Buyer</button>
                 <button onClick={() => handleRoleSwitch('seller')} className="w-full text-left px-4 py-2 rounded-md bg-green-50 text-green-700 hover:bg-green-100 font-medium">Switch to Seller</button>
                 <button onClick={() => handleRoleSwitch('shipment')} className="w-full text-left px-4 py-2 rounded-md bg-orange-50 text-orange-700 hover:bg-orange-100 font-medium">Switch to Shipment</button>
             </>}
           </div>
        )}

        {walletConnected && (
          <button
            onClick={handleWalletDisconnect}
            className="w-full text-left px-4 py-2 text-finovate-blue-600 hover:bg-finovate-blue-50 rounded-md flex items-center gap-2 font-medium"
          >
            <span>Disconnect Wallet</span>
          </button>
        )}

        <button
          onClick={onLogout}
          className="w-full text-left px-4 py-2 text-red-600 hover:bg-red-50 rounded-md flex items-center gap-2 font-medium"
        >
          <span>Logout</span>
        </button>

        <div className="mt-4 flex items-center gap-3 px-2 py-2 bg-gray-50 rounded-lg">
            <img src="/pfp.jpg" className="w-8 h-8 rounded-full object-cover" alt="User" />
            <div className="text-sm font-medium truncate text-gray-700">{user?.email}</div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;