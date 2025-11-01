import React from 'react';

const Sidebar = ({ activeTab, onTabChange, user, stats }) => {
  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'quotations', label: 'Quotations', icon: '💬' },
    { id: 'invoices', label: 'Invoices', icon: '📝' },
    { id: 'produce', label: 'Produce', icon: '🌱' }, // Add this tab
    { id: 'payments', label: 'Payments', icon: '💳' },
    { id: 'escrow', label: 'Escrow', icon: '🔒' },
  ];
  const displayStats = stats || { totalInvoices: 0, activeEscrows: 0, completed: 0 };

  // Add Financing tab for relevant roles
  if (user?.role === 'seller' || user?.role === 'investor' || user?.role === 'admin') {
    tabs.push({ id: 'financing', label: 'Financing', icon: '💸' });
  }

  if (user?.role === 'admin') {
    tabs.push({ id: 'admin', label: 'Admin', icon: '⚙️' });
  }

  return (
    <div className="bg-white shadow-md rounded-lg p-4 h-fit">
      <h2 className="text-lg font-semibold mb-4">Navigation</h2>
      <ul className="space-y-2">
        {tabs.map(tab => (
          <li key={tab.id}>
            <button
              onClick={() => onTabChange(tab.id)}
              className={`w-full text-left px-4 py-2 rounded-md transition-colors flex items-center space-x-2 ${
                activeTab === tab.id
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
    </div>
  );
};

export default Sidebar;