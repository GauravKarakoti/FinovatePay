import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Header from './components/Dashboard/Header';
import Sidebar from './components/Dashboard/Sidebar';
import Login from './components/Login';
import Register from './components/Register';
import SellerDashboard from './pages/SellerDashboard';
import BuyerDashboard from './pages/BuyerDashboard';
import AdminDashboard from './pages/AdminDashboard';
import ProduceHistory from './pages/ProduceHistory';
import InvoiceDetails from './pages/InvoiceDetails';
import ShipmentDashboard from './pages/ShipmentDashboard';
import InvestorDashboard from './pages/InvestorDashboard';
import { connectWallet } from './utils/web3';
import Web3Modal from 'web3modal';
import { Toaster } from 'sonner';
import FinovateChatbot from './components/Chatbot/Chatbot';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [walletConnected, setWalletConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);

  const [dashboardStats, setDashboardStats] = useState({
    totalInvoices: 0,
    activeEscrows: 0,
    completed: 0,
    produceLots: 0,
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');

    if (token && userData) {
      setUser({ ...JSON.parse(userData), token });
    }

    const web3Modal = new Web3Modal({ cacheProvider: true });
    if (web3Modal.cachedProvider) {
      connectWallet()
        .then(() => setWalletConnected(true))
        .catch(() => setWalletConnected(false));
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    localStorage.setItem('token', user.token);
    localStorage.setItem('user', JSON.stringify(user));

    setDashboardStats({
      totalInvoices: 0,
      activeEscrows: 0,
      completed: 0,
      produceLots: 0,
    });
  }, [user]);

  useEffect(() => {
    if (user === null) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  }, [user]);

  const handleLogin = (userData, token) => {
    setUser({ ...userData, token });
  };

  const handleLogout = () => {
    setUser(null);
  };

  const renderDashboard = (component) => (
    <div className="flex min-h-screen bg-gradient-to-l from-white via-[#6DD5FA] to-[#2980B9]">
      <div className="md:w-64 hidden md:block">
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          user={user}
          stats={dashboardStats}
        />
      </div>
      <div className="flex-1 overflow-auto">
        {React.cloneElement(component, { onStatsChange: setDashboardStats })}
      </div>
    </div>
  );

  const RequireAuth = ({ children, allowedRoles }) => {
    const location = useLocation();

    if (!user) {
      return <Navigate to="/login" state={{ from: location.pathname }} replace />;
    }

    if (allowedRoles && !allowedRoles.includes(user.role)) {
      return <Navigate to="/" replace />;
    }

    return children;
  };

  return (
    <Router>
      <Toaster position="top" richColors />
      <Header
        user={user}
        onLogout={handleLogout}
        walletConnected={walletConnected}
        onUserUpdate={setUser}
      />

      <main>
        <Routes>
          {/* Root route */}
          <Route
            path="/"
            element={
              user ? (
                user.role === 'admin'
                  ? renderDashboard(<AdminDashboard activeTab={activeTab} />)
                  : user.role === 'buyer'
                  ? <Navigate to="/buyer" />
                  : user.role === 'shipment' || user.role === 'warehouse'
                  ? <Navigate to="/shipment" />
                  : user.role === 'investor'
                  ? <Navigate to="/investor" />
                  : renderDashboard(<SellerDashboard activeTab={activeTab} />)
              ) : (
                <Navigate to="/login" />
              )
            }
          />

          {/* Seller */}
          <Route
            path="/seller-dashboard"
            element={
              <RequireAuth allowedRoles={['seller']}>
                {renderDashboard(<SellerDashboard activeTab={activeTab} />)}
              </RequireAuth>
            }
          />

          {/* Buyer */}
          <Route
            path="/buyer"
            element={
              user?.role === 'buyer'
                ? renderDashboard(<BuyerDashboard activeTab={activeTab} />)
                : <Navigate to="/" />
            }
          />

          {/* Investor */}
          <Route
            path="/investor"
            element={
              user?.role === 'investor'
                ? renderDashboard(<InvestorDashboard activeTab={activeTab} />)
                : <Navigate to="/" />
            }
          />

          {/* Admin */}
          <Route
            path="/admin"
            element={
              user?.role === 'admin'
                ? renderDashboard(<AdminDashboard activeTab={activeTab} />)
                : <Navigate to="/" />
            }
          />

          {/* Shipment */}
          <Route
            path="/shipment"
            element={
              user && (user.role === 'shipment' || user.role === 'warehouse')
                ? <ShipmentDashboard />
                : <Navigate to="/" />
            }
          />

          <Route path="/produce/:lotId" element={<ProduceHistory />} />

          <Route
            path="/invoices/:id"
            element={user ? <InvoiceDetails /> : <Navigate to="/login" />}
          />

          <Route
            path="/login"
            element={user ? <Navigate to="/" /> : <Login onLogin={handleLogin} />}
          />

          <Route
            path="/register"
            element={user ? <Navigate to="/" /> : <Register onLogin={handleLogin} />}
          />
        </Routes>
      </main>

      {user && (
        <>
          {isChatbotOpen && (
            <div className="fixed bottom-[90px] right-[30px] z-[999]">
              <FinovateChatbot />
            </div>
          )}

          <button
            onClick={() => setIsChatbotOpen(!isChatbotOpen)}
            className="fixed bottom-5 right-5 bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 z-[1000]"
          >
            {isChatbotOpen ? '✖' : '💬'}
          </button>
        </>
      )}
    </Router>
  );
}

export default App;