import React from 'react';
import { connectWallet, disconnectWallet } from '../../utils/web3';

// FIX: Receive the onToggleRole prop
const Header = ({ user, onLogout, walletConnected, onToggleRole }) => {
  const handleWalletConnect = async () => {
    try {
      await connectWallet();
      window.location.reload();
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    }
  };

  const handleWalletDisconnect = async () => {
    await disconnectWallet();
    window.location.reload();
  };

  return (
    <header className="bg-finovate-blue-800 text-white shadow-lg">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-bold">FinovatePay</h1>
        </div>

        <div className="flex items-center space-x-4">
          {/* Wallet connect/disconnect buttons... */}
          {walletConnected ? (
              <button
                  onClick={handleWalletDisconnect}
                  className="bg-finovate-blue-600 hover:bg-finovate-blue-700 px-3 py-1 rounded text-sm"
              >
                  Disconnect Wallet
              </button>
          ) : (
              <button
                  onClick={handleWalletConnect}
                  className="bg-finovate-green-600 hover:bg-finovate-green-700 px-3 py-1 rounded text-sm"
              >
                  Connect Wallet
              </button>
          )}

          {user && (
            <div className="flex items-center space-x-2">
              <span className="hidden md:inline">Hello, {user.email}</span>
              
              {/* FIX: Add the role-switching button for non-admin users */}
              {user.role !== 'admin' && (
                <button
                  onClick={onToggleRole}
                  className="bg-yellow-500 hover:bg-yellow-600 px-3 py-1 rounded text-sm"
                  title="Toggle role (for development)"
                >
                  {user.role === 'buyer' ? 'Switch to Seller' : 'Switch to Buyer'}
                </button>
              )}

              <button
                onClick={onLogout}
                className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;