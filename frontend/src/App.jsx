import React, { useState, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { setNavigateFunction } from './utils/api';


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
import Invoices from './pages/Invoices';

import FinovateChatbot from './components/Chatbot/Chatbot';

import { connectWallet } from './utils/web3';
import Web3Modal from 'web3modal';
import { Toaster } from 'sonner';

import './App.css';

/* -------------------- Error Boundary Component -------------------- */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null,
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log error to console in development
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      // Render error UI
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '20px',
          textAlign: 'center',
          backgroundColor: '#f5f5f5'
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '40px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            maxWidth: '500px',
            width: '100%'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
            <h2 style={{ 
              color: '#dc2626', 
              marginBottom: '16px',
              fontSize: '24px',
              fontWeight: '600'
            }}>
              Something went wrong
            </h2>
            <p style={{ 
              color: '#6b7280', 
              marginBottom: '24px',
              lineHeight: '1.5'
            }}>
              We're sorry, but something unexpected happened. Please try again.
            </p>
            
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details style={{
                marginBottom: '24px',
                padding: '12px',
                backgroundColor: '#f3f4f6',
                borderRadius: '6px',
                textAlign: 'left',
                fontSize: '12px',
                fontFamily: 'monospace'
              }}>
                <summary style={{ cursor: 'pointer', fontWeight: '600' }}>
                  Error Details (Development Only)
                </summary>
                <pre style={{ 
                  marginTop: '8px', 
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
            
            <button
              onClick={this.handleRetry}
              style={{
                padding: '12px 24px',
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#1d4ed8'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#2563eb'}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/* -------------------- Navigation Setup -------------------- */
function NavigationSetup() {
  const navigate = useNavigate();
  
  useEffect(() => {
    setNavigateFunction(navigate);
  }, [navigate]);
  
  return null;
}

/* -------------------- Auth Wrapper -------------------- */
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


/* -------------------- App -------------------- */
function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
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

  /* -------------------- Effects -------------------- */
  useEffect(() => {
    const userData = localStorage.getItem('user');

    if (userData) {
      setUser(JSON.parse(userData));
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
      localStorage.removeItem('user');
      return;
    }
    localStorage.setItem('user', JSON.stringify(user));
  }, [user]);


  /* -------------------- Handlers -------------------- */
  const handleLogin = (userData) => {
    setUser(userData);
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

  /* -------------------- Routes -------------------- */
  return (
    <ErrorBoundary>
      <Router>

      <NavigationSetup />
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
            path="/seller"
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

          {/* Invoices */}
          <Route
            path="/invoices"
            element={
              <RequireAuth>
                {renderDashboard(<Invoices />)}
              </RequireAuth>
            }
          />

          <Route
            path="/invoices/:id"
            element={user ? <InvoiceDetails /> : <Navigate to="/login" />}
          />

          {/* Dispute */}
          <Route
            path="/dispute/:invoiceId"
            element={
              <RequireAuth>
                {renderDashboard(<DisputeDashboard />)}
              </RequireAuth>
            }
          />

          {/* Public */}
          <Route path="/produce/:lotId" element={<ProduceHistory />} />

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
    </ErrorBoundary>
  );
}

export default App;
