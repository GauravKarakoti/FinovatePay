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
import { connectWallet } from './utils/web3';
import Web3Modal from 'web3modal';
import './App.css';
import { Toaster } from 'sonner';
import FinovateChatbot from './components/Chatbot/Chatbot';
import ShipmentDashboard from './pages/ShipmentDashboard';
import InvestorDashboard from './pages/InvestorDashboard';
import { useStatsActions } from './context/StatsContext';

function App() {
  const [user, setUser] = useState(null);
  const [walletConnected, setWalletConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [dashboardStats, setDashboardStats] = useState({
      totalInvoices: 0,
      activeEscrows: 0,
      completed: 0,
      produceLots: 0,
  });
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);
  const { resetStats } = useStatsActions(); // Use actions hook to avoid undefined context during login

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    if (token && userData) {
      setUser(JSON.parse(userData));
    }

    const web3Modal = new Web3Modal({ cacheProvider: true });
    if (web3Modal.cachedProvider) {
      connectWallet()
        .then(() => {
          setWalletConnected(true);
        })
        .catch((error) => {
          console.error("Failed to auto-connect wallet:", error);
          setWalletConnected(false);
        });
    }
  }, []);

  const handleLogin = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    resetStats();
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    resetStats();
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  const renderDashboard = (dashboardComponent) => {
    return (
      <div className="flex min-h-screen bg-gradient-to-l from-white via-[#6DD5FA] to-[#2980B9]">
          <div className="md:w-64 flex-shrink-0 hidden md:block">
              <Sidebar 
                  activeTab={activeTab} 
                  onTabChange={handleTabChange} 
                  user={user} 
              />
          </div>
          <div className="flex-1 overflow-auto">
                {dashboardComponent}
          </div>
      </div>
    );
  };

  const toggleChatbot = () => {
    setIsChatbotOpen(prevState => !prevState);
  };

  // ✅ AUTH GUARD: Saves intended route in location state
  const RequireAuth = ({ children, allowedRoles }) => {
    const location = useLocation();
    
    if (!user) {
      // Not logged in: redirect to login, remembering where they came from
      return <Navigate to="/login" state={{ from: location.pathname }} replace />;
    }
    
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      // Logged in but wrong role: send to home (which handles role-based landing)
      return <Navigate to="/" replace />;
    }
    
    return children;
  };

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
        {console.log('Current user role in App.jsx:', user)}
        <main>
          <Routes>
            {/* Home route - keeps existing role-based logic */}
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
            
            {/* ✅ PROTECTED: Buyer */}
            <Route 
                path="/buyer" 
                element={
                    <RequireAuth allowedRoles={['buyer']}>
                        {renderDashboard(<BuyerDashboard activeTab={activeTab} />)}
                    </RequireAuth>
                }
            />
            
            {/* ✅ PROTECTED: Investor */}
            <Route 
                path="/investor" 
                element={
                    <RequireAuth allowedRoles={['investor']}>
                        {renderDashboard(<InvestorDashboard activeTab={activeTab} />)}
                    </RequireAuth>
                }
            />
            
            {/* ✅ PROTECTED: Admin */}
            <Route 
              path="/admin"
              element={
                <RequireAuth allowedRoles={['admin']}>
                    {renderDashboard(<AdminDashboard activeTab={activeTab} />)}
                </RequireAuth>
              } 
            />
            
            {/* ✅ PROTECTED: Shipment/Warehouse */}
            <Route 
              path="/shipment" 
              element={
                <RequireAuth allowedRoles={['shipment', 'warehouse']}>
                    <ShipmentDashboard />
                </RequireAuth>
              } 
            />
            
            {/* Public: Produce History */}
            <Route 
              path="/produce/:lotId" 
              element={<ProduceHistory />}
            />
            
            {/* Auth Pages */}
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
        
        {/* Chatbot UI */}
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