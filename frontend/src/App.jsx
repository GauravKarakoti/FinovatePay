import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Dashboard/Header';
import Sidebar from './components/Dashboard/Sidebar';
import Login from './components/Login';
import Register from './components/Register';
import SellerDashboard from './pages/SellerDashboard';
import BuyerDashboard from './pages/BuyerDashboard';
import AdminDashboard from './pages/AdminDashboard';
import ProduceHistory from './pages/ProduceHistory'; // Add this import
import { connectWallet } from './utils/web3';
import Web3Modal from 'web3modal';
import './App.css';
import { Toaster } from 'sonner';

function App() {
  const [user, setUser] = useState(null);
  const [walletConnected, setWalletConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [dashboardStats, setDashboardStats] = useState({
      totalInvoices: 0,
      activeEscrows: 0,
      completed: 0,
      produceLots: 0, // Add produce lots to stats
  });

  useEffect(() => {
    // Check if user is logged in from a previous session
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    if (token && userData) {
      setUser(JSON.parse(userData));
    }

    // FIX: Only try to auto-connect if a wallet was previously connected
    const web3Modal = new Web3Modal({ cacheProvider: true });
    if (web3Modal.cachedProvider) {
      connectWallet()
        .then(() => {
          setWalletConnected(true);
        })
        .catch((error) => {
          // Log the error for easier debugging
          console.error("Failed to auto-connect wallet:", error);
          setWalletConnected(false);
        });
    }
  }, []);

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

  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };
  
    // FIX: Add this function to toggle the user's role
  const handleToggleRole = () => {
    if (!user || user.role === 'admin') return; // Don't allow admins to change role this way

    // Determine the new role
    const newRole = user.role === 'buyer' ? 'seller' : 'buyer';
    
    // Create an updated user object
    const updatedUser = { ...user, role: newRole };
    
    // Update the state and localStorage
    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
  };


  const renderDashboard = (dashboardComponent) => {
    return (
      <div className="flex min-h-screen bg-gradient-to-l from-white via-[#6DD5FA] to-[#2980B9]">
          <div className="md:w-64 flex-shrink-0 hidden md:block">
              {/* 2. Pass the stats state down to the Sidebar */}
              <Sidebar 
                  activeTab={activeTab} 
                  onTabChange={handleTabChange} 
                  user={user} 
                  stats={dashboardStats} 
              />
          </div>
          <div className="flex-1 overflow-auto">
              {/* 3. Pass the state setter down to the active dashboard */}
              {React.cloneElement(dashboardComponent, { onStatsChange: setDashboardStats })}
          </div>
      </div>
    );
  };

  return (
    <Router>
      <Toaster position="top" richColors />
      <div className="App">
        <Header 
            user={user} 
            onLogout={handleLogout} 
            walletConnected={walletConnected}
            onToggleRole={handleToggleRole} 
        />
        
        <main>
          <Routes>
            <Route 
                path="/" 
                element={
                    user ? (
                        user.role === 'admin' ? (
                            renderDashboard(<AdminDashboard activeTab={activeTab} />)
                        ) : user.role === 'buyer' ? (
                            <Navigate to="/buyer" />
                        ) : (
                            renderDashboard(<SellerDashboard activeTab={activeTab} />)
                        )
                    ) : (
                        <Navigate to="/login" />
                    )
                } 
            />
            <Route 
                path="/buyer" 
                element={
                    user && user.role === 'buyer' 
                        ? renderDashboard(<BuyerDashboard activeTab={activeTab} />) 
                        : <Navigate to="/" />
                }
            />
            <Route 
              path="/admin" 
              element={
                user && user.role === 'admin' ? renderDashboard(<AdminDashboard activeTab={activeTab} />) : <Navigate to="/" />
              } 
            />
            {/* Add produce history route */}
            <Route 
              path="/produce/:lotId" 
              element={<ProduceHistory />}
            />
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
      </div>
    </Router>
  );
}

export default App;