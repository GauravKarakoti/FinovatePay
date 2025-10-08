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
                  className="bg-finovate-blue-600 hover:bg-finovate-blue-700 px-4 py-2 rounded-full transition-all duration-300 hover:scale-105 text-sm text-white shadow-sm hover:shadow-md"
              >
                  Disconnect Wallet
              </button>
          ) : (
              <button
                  onClick={handleWalletConnect}
                  className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded-full transition-all duration-300 hover:scale-105 text-sm text-white shadow-sm hover:shadow-md"
              >
                  Connect Wallet
              </button>
          )}

          {user && (
            <div className="flex items-center space-x-2">
              
              {/* FIX: Add the role-switching button for non-admin users */}
              {user.role !== 'admin' && (
                <div>
                  {user.role === 'buyer' ? <div className="flex items-center space-x-2">
                      <button onClick={() => onToggleRole('seller')} className="px-3 py-1 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700">
                          Switch to Seller
                      </button>
                      <button onClick={() => onToggleRole('shipment')} className="px-3 py-1 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700">
                          Switch to Shipment
                      </button>
                  </div> : user.role === 'seller' ? <div className="flex items-center space-x-2">
                      <button onClick={() => onToggleRole('buyer')} className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">
                          Switch to Buyer
                      </button>
                      <button onClick={() => onToggleRole('shipment')} className="px-3 py-1 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700">
                          Switch to Shipment
                      </button>
                  </div> : <div className="flex items-center space-x-2">
                      <button onClick={() => onToggleRole('buyer')} className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">
                          Switch to Buyer
                      </button>
                      <button onClick={() => onToggleRole('seller')} className="px-3 py-1 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700">
                          Switch to Seller
                      </button>
                  </div>}
                </div>
              )}

              <button
                onClick={onLogout}
                className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded-full text-sm"
              >
                Logout
              </button>
                <div className="flex items-center space-x-2">
              <img
              src="/pfp.jpg" // ✅ Path from public
              alt="User PFP"
               className="w-8 h-8 rounded-full object-cover"
               />
                <span className="text-sm font-medium">{user.email}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;