import { connectWallet, disconnectWallet } from '../../utils/web3';
import { updateCurrentUserRole } from '../../utils/api';
import { useNavigate } from 'react-router-dom';

// FIX: Receive the onToggleRole prop
const Header = ({ user, onLogout, walletConnected, onUserUpdate }) => {
  const navigate = useNavigate();
  const [showRoleMenu, setShowRoleMenu] = useState(false);
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
          {console.log('User in Header.jsx:', user)}
          {/* Mobile toggle button - visible only on mobile */}
          <button
            onClick={() => setShowRoleMenu(!showRoleMenu)}
            className="md:hidden flex items-center justify-center w-8 h-8 bg-blue-600 hover:bg-blue-700 rounded-md text-white text-xs"
            title="Toggle role menu"
          >
            {showRoleMenu ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>

          {/* Role switch buttons - visible on desktop, hidden on mobile by default */}
          <div className={`${showRoleMenu ? 'flex' : 'hidden'} md:flex absolute md:relative top-12 left-0 right-0 md:top-0 bg-finovate-blue-800 md:bg-transparent w-full md:w-auto md:items-center space-y-1 md:space-y-0 md:space-x-1 p-2 md:p-0 flex-col md:flex-row z-50 rounded-b-md md:rounded-none`}>
            {user && (
              <div className="flex items-center space-x-1 flex-wrap w-full">

                {user.role !== 'admin' && (
                  <div>
                    {/* START: 3. UPDATE ALL onClicks */}
                    {user.role === 'buyer' ? <div className="flex items-center space-x-1 flex-wrap w-full md:w-auto">
                      <button onClick={() => { handleRoleSwitch('seller'); setShowRoleMenu(false); }} className="px-2 py-0.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 w-full md:w-auto">
                        Switch to Seller
                      </button>
                      <button onClick={() => { handleRoleSwitch('shipment'); setShowRoleMenu(false); }} className="px-2 py-0.5 text-xs font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 w-full md:w-auto">
                        Switch to Shipment
                      </button>
                      <button onClick={() => { handleRoleSwitch('investor'); setShowRoleMenu(false); }} className="px-2 py-0.5 text-xs font-medium text-white bg-gray-600 rounded-md hover:bg-gray-700 w-full md:w-auto">
                        Switch to Investor
                      </button>
                    </div> : user.role === 'seller' ? <div className="flex items-center space-x-1 flex-wrap w-full md:w-auto">
                      <button onClick={() => { handleRoleSwitch('buyer'); setShowRoleMenu(false); }} className="px-2 py-0.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 w-full md:w-auto">
                        Switch to Buyer
                      </button>
                      <button onClick={() => { handleRoleSwitch('shipment'); setShowRoleMenu(false); }} className="px-2 py-0.5 text-xs font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 w-full md:w-auto">
                        Switch to Shipment
                      </button>
                      <button onClick={() => { handleRoleSwitch('investor'); setShowRoleMenu(false); }} className="px-2 py-0.5 text-xs font-medium text-white bg-gray-600 rounded-md hover:bg-gray-700 w-full md:w-auto">
                        Switch to Investor
                      </button>
                    </div> : user.role === 'shipment' ? <div className="flex items-center space-x-1 flex-wrap w-full md:w-auto">
                      <button onClick={() => { handleRoleSwitch('buyer'); setShowRoleMenu(false); }} className="px-2 py-0.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 w-full md:w-auto">
                        Switch to Buyer
                      </button>
                      <button onClick={() => { handleRoleSwitch('seller'); setShowRoleMenu(false); }} className="px-2 py-0.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 w-full md:w-auto">
                        Switch to Seller
                      </button>
                      <button onClick={() => { handleRoleSwitch('investor'); setShowRoleMenu(false); }} className="px-2 py-0.5 text-xs font-medium text-white bg-gray-600 rounded-md hover:bg-gray-700 w-full md:w-auto">
                        Switch to Investor
                      </button>
                    </div> : <div className="flex items-center space-x-1 flex-wrap w-full md:w-auto">
                      <button onClick={() => { handleRoleSwitch('buyer'); setShowRoleMenu(false); }} className="px-2 py-0.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 w-full md:w-auto">
                        Switch to Buyer
                      </button>
                      <button onClick={() => { handleRoleSwitch('seller'); setShowRoleMenu(false); }} className="px-2 py-0.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 w-full md:w-auto">
                        Switch to Seller
                      </button>
                      <button onClick={() => { handleRoleSwitch('shipment'); setShowRoleMenu(false); }} className="px-2 py-0.5 text-xs font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 w-full md:w-auto">
                        Switch to Shipment
                      </button>
                    </div>}
                  </div>
                )}

                <div className="md:hidden w-full border-t border-finovate-blue-600 mt-1 pt-1">
                <button
                  onClick={() => { onLogout(); setShowRoleMenu(false); }}
                  className="bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded-full text-xs w-full"
                >
                  Logout
                </button>
                <div className="flex items-center space-x-2 mb-2">
                  <img
                    src="/pfp.jpg" // ✅ Path from public
                    alt="User PFP"
                    className="w-8 h-8 rounded-full object-cover"
                  />
                  <span className="text-sm font-medium">{user.email}</span>
                </div>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
    </header>
  );
};

export default Header;