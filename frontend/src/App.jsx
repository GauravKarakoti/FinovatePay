import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
import InvoiceTracking from './pages/InvoiceTracking';
import InvoiceDetails from './pages/InvoiceDetails';
import DisputeDashboard from './pages/DisputeDashboard';
import { connectWallet } from './utils/web3';
import Web3Modal from 'web3modal';
import { Toaster, toast } from 'sonner';
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

  // ================= INIT =================
  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    
    if (token && userData) {
      const parsedUser = JSON.parse(userData);
      setUser({ ...parsedUser, token });
    }

    const web3Modal = new Web3Modal({ cacheProvider: true });

    if (web3Modal.cachedProvider) {
      connectWallet()
        .then(() => setWalletConnected(true))
        .catch((error) => {
          console.error("Failed to auto-connect wallet:", error);
          web3Modal.clearCachedProvider();
          setWalletConnected(false);
          toast.error('Wallet connection expired. Please reconnect your wallet.');
        });
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const tokenToStore = user.token || localStorage.getItem('token');
    if (tokenToStore) {
        localStorage.setItem('token', tokenToStore);
    }
    localStorage.setItem('user', JSON.stringify(user));
  }, [user]);

  useEffect(() => {
    if (user === null && localStorage.getItem('token')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  }, [user]);

  // ================= AUTH =================
  const handleLogin = (userData, token) => {
    setUser({ ...userData, token });
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  // ================= LAYOUT WRAPPER =================
  const renderDashboard = (dashboardComponent) => {
    return (
      <div className="flex min-h-screen bg-gradient-to-l from-white via-[#6DD5FA] to-[#2980B9]">
        <div className="md:w-64 flex-shrink-0 hidden md:block">
          <Sidebar 
            activeTab={activeTab} 
            onTabChange={handleTabChange} 
            user={user} 
            stats={dashboardStats} 
          />
        </div>
        <div className="flex-1 overflow-auto">
          {React.cloneElement(dashboardComponent, { onStatsChange: setDashboardStats })}
        </div>
      </div>
    );
  };

  // ================= CHATBOT =================
  const toggleChatbot = () => {
    setIsChatbotOpen(prev => !prev);
  };

  // ================= AUTH GUARD =================
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

  // ================= ROUTES =================
  return (
    <Router>
      <Toaster position="top" richColors />
      <div className="App">
        <Header 
          user={user} 
          onLogout={handleLogout} 
          walletConnected={walletConnected}
          onUserUpdate={setUser}
        />
        <main>
          <Routes>
            {/* ================= ROOT ================= */}
            <Route 
              path="/" 
              element={
                user ? (
                  user.role === 'admin' ? (
                    renderDashboard(<AdminDashboard activeTab={activeTab} />)
                  ) : user.role === 'buyer' ? (
                    <Navigate to="/buyer" />
                  ) : user.role === 'shipment' || user.role === 'warehouse' ? (
                    <Navigate to="/shipment" />
                  ) : user.role === 'investor' ? (
                    <Navigate to="/investor" />
                  ) : (
                    renderDashboard(<SellerDashboard activeTab={activeTab} />)
                  )
                ) : (
                  <Navigate to="/login" />
                )
              } 
            />
            
            {/* ================= BUYER ================= */}
            <Route 
              path="/buyer" 
              element={
                <RequireAuth allowedRoles={['buyer']}>
                  {renderDashboard(<BuyerDashboard activeTab={activeTab} />)}
                </RequireAuth>
              }
            />
            
            {/* ================= INVESTOR ================= */}
            <Route 
              path="/investor" 
              element={
                <RequireAuth allowedRoles={['investor']}>
                  {renderDashboard(<InvestorDashboard activeTab={activeTab} />)}
                </RequireAuth>
              }
            />
            
            {/* ================= ADMIN ================= */}
            <Route 
              path="/admin"
              element={
                <RequireAuth allowedRoles={['admin']}>
                  {renderDashboard(<AdminDashboard activeTab={activeTab} />)}
                </RequireAuth>
              } 
            />
            
            {/* ================= SHIPMENT ================= */}
            <Route 
              path="/shipment" 
              element={
                <RequireAuth allowedRoles={['shipment', 'warehouse']}>
                  <ShipmentDashboard />
                </RequireAuth>
              } 
            />
            
            {/* ================= INVOICE TRACKING ================= */}
            <Route 
              path="/tracking"
              element={
                <RequireAuth allowedRoles={['buyer', 'seller', 'admin', 'investor']}>
                  {renderDashboard(<InvoiceTracking />)}
                </RequireAuth>
              }
            />
            
            {/* ================= INVOICE DETAILS ================= */}
            <Route 
              path="/invoices/:id" 
              element={
                <RequireAuth allowedRoles={['buyer', 'seller', 'admin', 'investor']}>
                  <InvoiceDetails />
                </RequireAuth>
              } 
            />
            
            {/* ================= DISPUTE CENTER ================= */}
            <Route 
              path="/dispute/:invoiceId" 
              element={
                <RequireAuth allowedRoles={['buyer', 'seller', 'admin']}>
                  {renderDashboard(<DisputeDashboard />)}
                </RequireAuth>
              } 
            />
            
            {/* ================= PRODUCE ================= */}
            <Route 
              path="/produce/:lotId" 
              element={<ProduceHistory />} 
            />
            
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
        </main>
        
        {/* ================= CHATBOT ================= */}
        {user && (
          <>
            <div style={{ position: 'fixed', bottom: '90px', right: '30px', zIndex: 999 }}>
              {isChatbotOpen && <FinovateChatbot />}
            </div>
            <button
              onClick={toggleChatbot}
              className="fixed bottom-5 right-5 bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-opacity-50 transition-transform transform hover:scale-110 z-[1000]"
              aria-label="Toggle Chatbot"
            >
              {isChatbotOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              )}
            </button>
          </>
        )}
      </div>
    </Router>
  );
}

export default App;