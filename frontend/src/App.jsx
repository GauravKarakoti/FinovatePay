import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import Header from './components/Dashboard/Header';
import Sidebar from './components/Dashboard/Sidebar';

import Login from './components/Login';
import Register from './components/Register';

import SellerDashboard from './pages/SellerDashboard';
import BuyerDashboard from './pages/BuyerDashboard';
import AdminDashboard from './pages/AdminDashboard';
import ShipmentDashboard from './pages/ShipmentDashboard';
import ProduceHistory from './pages/ProduceHistory';
import InvestorDashboard from './pages/InvestorDashboard';
import InvoiceTracking from './pages/InvoiceTracking'; // ⭐ NEW

import FinovateChatbot from './components/Chatbot/Chatbot';

import { connectWallet } from './utils/web3';
import Web3Modal from 'web3modal';

import { Toaster } from 'sonner';

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

  // ================= INIT =================
  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');

    if (token && userData) {
      setUser(JSON.parse(userData));
    }

    const web3Modal = new Web3Modal({ cacheProvider: true });

    if (web3Modal.cachedProvider) {
      connectWallet()
        .then(() => setWalletConnected(true))
        .catch(() => setWalletConnected(false));
    }
  }, []);

  // ================= AUTH =================
  const handleLogin = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  // ================= LAYOUT WRAPPER =================
  const renderDashboard = (component) => {
    return (
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
  };

  // ================= CHATBOT =================
  const toggleChatbot = () => setIsChatbotOpen(prev => !prev);

  // ================= ROUTES =================
  return (
    <Router>
      <Toaster position="top" richColors />

      <Header
        user={user}
        onLogout={handleLogout}
        walletConnected={walletConnected}
        onUserUpdate={setUser}
      />

      <Routes>

        {/* ================= ROOT ================= */}
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

        {/* ================= BUYER ================= */}
        <Route
          path="/buyer"
          element={
            user?.role === 'buyer'
              ? renderDashboard(<BuyerDashboard activeTab={activeTab} />)
              : <Navigate to="/" />
          }
        />

        {/* ================= INVESTOR ================= */}
        <Route
          path="/investor"
          element={
            user?.role === 'investor'
              ? renderDashboard(<InvestorDashboard activeTab={activeTab} />)
              : <Navigate to="/" />
          }
        />

        {/* ================= ADMIN ================= */}
        <Route
          path="/admin"
          element={
            user?.role === 'admin'
              ? renderDashboard(<AdminDashboard activeTab={activeTab} />)
              : <Navigate to="/" />
          }
        />

        {/* ================= SHIPMENT ================= */}
        <Route
          path="/shipment"
          element={
            user && (user.role === 'shipment' || user.role === 'warehouse')
              ? <ShipmentDashboard />
              : <Navigate to="/" />
          }
        />

        {/* ================= TRACKING DASHBOARD ⭐ NEW ================= */}
        <Route
          path="/tracking"
          element={
            user
              ? renderDashboard(<InvoiceTracking />)
              : <Navigate to="/login" />
          }
        />

        {/* ================= PRODUCE ================= */}
        <Route path="/produce/:lotId" element={<ProduceHistory />} />

        {/* ================= AUTH ================= */}
        <Route
          path="/login"
          element={
            user ? <Navigate to="/" /> : <Login onLogin={handleLogin} />
          }
        />

        <Route
          path="/register"
          element={
            user ? <Navigate to="/" /> : <Register onLogin={handleLogin} />
          }
        />

      </Routes>

      {/* ================= CHATBOT ================= */}
      {user && (
        <>
          <div style={{ position: 'fixed', bottom: 90, right: 30, zIndex: 999 }}>
            {isChatbotOpen && <FinovateChatbot />}
          </div>

          <button
            onClick={toggleChatbot}
            className="fixed bottom-5 right-5 bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 z-[1000]"
          >
            {isChatbotOpen ? '✕' : '💬'}
          </button>
        </>
      )}
    </Router>
  );
}

export default App;
