import React from 'react';

const Sidebar = ({ activeTab, onTabChange, user }) => {
  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'invoices', label: 'Invoices', icon: '📝' },
    { id: 'payments', label: 'Payments', icon: '💳' },
    { id: 'escrow', label: 'Escrow', icon: '🔒' },
  ];

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
          <div className="flex justify-between">
            <span>Total Invoices:</span>
            <span className="font-medium">24</span>
          </div>
          <div className="flex justify-between">
            <span>Active Escrows:</span>
            <span className="font-medium">3</span>
          </div>
          <div className="flex justify-between">
            <span>Completed:</span>
            <span className="font-medium">18</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;