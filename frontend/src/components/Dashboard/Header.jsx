import { connectWallet, disconnectWallet } from '../../utils/web3';
import { updateCurrentUserRole } from '../../utils/api';
import { useNavigate, Link } from 'react-router-dom';

// FIX: Receive the onToggleRole prop
const Header = ({ user, onLogout, walletConnected, onUserUpdate, onToggleSidebar }) => {
  const navigate = useNavigate();
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

  const handleRoleSwitch = async (newRole) => {
    try {
      const response = await updateCurrentUserRole(newRole);
      console.log('Role switch response:', response);

      if (response && response.data.user) {
        // 4. THIS IS THE FIX:
        //    Update localStorage
        localStorage.setItem('user', JSON.stringify(response.data.user));
        //    Update the live React state in App.jsx
        onUserUpdate(response.data.user);

        // 5. Navigate to the root. App.jsx's routing logic
        //    will see the new role and navigate to the correct dashboard.
        navigate(`/`);
      } else {
        console.error('API response did not contain user object.', response);
      }
    } catch (error) {
      console.error('Failed to switch role:', error);
    }
  };

  return (
    <header className="bg-finovate-blue-800 text-white shadow-lg sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center space-x-4">
          {/* Hamburger Menu for Mobile Sidebar */}
          {user && (
            <button
              onClick={onToggleSidebar}
              className="md:hidden text-white focus:outline-none"
              aria-label="Toggle Sidebar"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          <h1 className="text-xl font-bold">FinovatePay</h1>
          <Link
            to="/contributors"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-all duration-200 hover:scale-105"
          >
            <span>👥</span> Contributors
          </Link>
        </div>

        <div className="flex items-center space-x-2 md:space-x-4">
          {/* Wallet connect/disconnect buttons... */}
          {walletConnected ? (
              <button
                  onClick={handleWalletDisconnect}
                  className="hidden md:block bg-finovate-blue-600 hover:bg-finovate-blue-700 px-4 py-2 rounded-full transition-all duration-300 hover:scale-105 text-sm text-white shadow-sm hover:shadow-md"
              >
                  Disconnect
              </button>
          ) : (
              <button
                  onClick={handleWalletConnect}
                  className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded-full transition-all duration-300 hover:scale-105 text-sm text-white shadow-sm hover:shadow-md whitespace-nowrap"
              >
                  Connect
              </button>
          )}

          {user && (
            <div className="flex items-center space-x-2">
              
              {user.role !== 'admin' && (
                <div className="hidden lg:flex items-center space-x-2">
                  {/* Desktop Role Switcher */}
                  {user.role === 'buyer' ? <>
                      <button onClick={() => handleRoleSwitch('seller')} className="px-3 py-1 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700">Seller</button>
                      <button onClick={() => handleRoleSwitch('shipment')} className="px-3 py-1 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700">Shipment</button>
                      <button onClick={() => handleRoleSwitch('investor')} className="px-3 py-1 text-sm font-medium text-white bg-gray-600 rounded-md hover:bg-gray-700">Investor</button>
                  </> : user.role === 'seller' ? <>
                      <button onClick={() => handleRoleSwitch('buyer')} className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">Buyer</button>
                      <button onClick={() => handleRoleSwitch('shipment')} className="px-3 py-1 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700">Shipment</button>
                      <button onClick={() => handleRoleSwitch('investor')} className="px-3 py-1 text-sm font-medium text-white bg-gray-600 rounded-md hover:bg-gray-700">Investor</button>
                  </> : user.role === 'shipment' ? <>
                      <button onClick={() => handleRoleSwitch('buyer')} className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">Buyer</button>
                      <button onClick={() => handleRoleSwitch('seller')} className="px-3 py-1 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700">Seller</button>
                      <button onClick={() => handleRoleSwitch('investor')} className="px-3 py-1 text-sm font-medium text-white bg-gray-600 rounded-md hover:bg-gray-700">Investor</button>
                  </> : <>
                      <button onClick={() => handleRoleSwitch('buyer')} className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">Buyer</button>
                      <button onClick={() => handleRoleSwitch('seller')} className="px-3 py-1 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700">Seller</button>
                      <button onClick={() => handleRoleSwitch('shipment')} className="px-3 py-1 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700">Shipment</button>
                  </>}
                </div>
              )}

              {/* Mobile Role Switcher & Logout Dropdown (Simplified for now, can be expanded) */}

              <button
                onClick={onLogout}
                className="hidden md:block bg-red-600 hover:bg-red-700 px-3 py-1 rounded-full text-sm"
              >
                Logout
              </button>

              <div className="flex items-center space-x-2">
                <img
                  src="/pfp.jpg" // ✅ Path from public
                  alt="User PFP"
                  className="w-8 h-8 rounded-full object-cover"
                />
                <span className="hidden md:inline text-sm font-medium">{user.email}</span>
              </div>
            </div>
          )}  
        </div>
      </div>
    </header>
  );
};

export default Header;