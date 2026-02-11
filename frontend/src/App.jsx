import React, { useState, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';

import Header from './components/Dashboard/Header';
import Sidebar from './components/Dashboard/Sidebar';
import Login from './components/Login';
import Register from './components/Register';

import SellerDashboard from './pages/SellerDashboard';
import BuyerDashboard from './pages/BuyerDashboard';
import AdminDashboard from './pages/AdminDashboard';
import InvestorDashboard from './pages/InvestorDashboard';
import ShipmentDashboard from './pages/ShipmentDashboard';
import ProduceHistory from './pages/ProduceHistory';
import InvoiceDetails from './pages/InvoiceDetails';
import DisputeDashboard from './pages/DisputeDashboard';

import FinovateChatbot from './components/Chatbot/Chatbot';

import { connectWallet } from './utils/web3';
import Web3Modal from 'web3modal';
import { Toaster } from 'sonner';

import './App.css';

function RequireAuth({ children, allowedRoles }) {
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem('user'));

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function App() {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('user');
    return savedUser ? JSON.parse(savedUser) : null;
  });

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
    if (!user) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      return;
    }

    localStorage.setItem('token', user.token);
    localStorage.setItem('user', JSON.stringify(user));
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
          {/* Root */}
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
              <RequireAuth allowedRoles={['buyer']}>
                {renderDashboard(<BuyerDashboard activeTab={activeTab} />)}
              </RequireAuth>
            }
          />

          {/* Investor */}
          <Route
            path="/investor"
            element={
              <RequireAuth allowedRoles={['investor']}>
                {renderDashboard(<InvestorDashboard activeTab={activeTab} />)}
              </RequireAuth>
            }
          />

          {/* Admin */}
          <Route
            path="/admin"
            element={
              <RequireAuth allowedRoles={['admin']}>
                {renderDashboard(<AdminDashboard activeTab={activeTab} />)}
              </RequireAuth>
            }
          />

          {/* Shipment / Warehouse */}
          <Route
            path="/shipment"
            element={
              <RequireAuth allowedRoles={['shipment', 'warehouse']}>
                <ShipmentDashboard />
              </RequireAuth>
            }
          />

          {/* Dispute Dashboard */}
          <Route
            path="/dispute/:invoiceId"
            element={
              <RequireAuth>
                {renderDashboard(<DisputeDashboard />)}
              </RequireAuth>
            }
          />

          <Route path="/produce/:lotId" element={<ProduceHistory />} />

          <Route
            path="/invoices/:id"
            element={user ? <InvoiceDetails /> : <Navigate to="/login" />}
          />

          {/* Auth */}
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

      {/* Chatbot */}
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
            aria-label="Toggle Chatbot"
          >
            {isChatbotOpen ? '✖' : '💬'}
          </button>
        </>
      )}
    </Router>
  );
}

export default App;
