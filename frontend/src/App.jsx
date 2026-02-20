import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useWeb3ModalAccount } from '@web3modal/ethers/react';
import Header from './components/Dashboard/Header';
import Sidebar from './components/Dashboard/Sidebar';
import Login from './components/Login';
import Register from './components/Register';
import Invoices from './pages/Invoices';
import InvoiceDetails from './pages/InvoiceDetails';
import DisputeDashboard from './pages/DisputeDashboard';
import FinovateChatbot from './components/Chatbot/Chatbot';
import SellerDashboard from './pages/SellerDashboard';
import BuyerDashboard from './pages/BuyerDashboard';
import AdminDashboard from './pages/AdminDashboard';
import InvestorDashboard from './pages/InvestorDashboard';
import ShipmentDashboard from './pages/ShipmentDashboard';
import ProduceHistory from './pages/ProduceHistory';
import './App.css';
import { Toaster } from 'sonner';
import { useStatsActions } from './context/StatsContext';
import { setNavigateFunction } from './utils/api';

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
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);

  const [dashboardStats, setDashboardStats] = useState({
    totalInvoices: 0,
    activeEscrows: 0,
    completed: 0,
    produceLots: 0,
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { resetStats } = useStatsActions();
  
  // Use Web3Modal v3 hooks for wallet connection state
  const { isConnected } = useWeb3ModalAccount();

  /* -------------------- Effects -------------------- */
  useEffect(() => {
    const userData = localStorage.getItem('user');

    if (userData) {
      setUser(JSON.parse(userData));
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
    resetStats();
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setIsSidebarOpen(false);
  };

  const renderDashboard = (dashboardComponent) => {
    return (
      <div>
        <div className="flex min-h-screen bg-gradient-to-l from-white via-[#6DD5FA] to-[#2980B9] relative">
            {/* Mobile Backdrop */}
            {isSidebarOpen && (
              <div
                className="fixed inset-0 bg-black bg-opacity-50 z-30 md:hidden"
                onClick={() => setIsSidebarOpen(false)}
              />
            )}

            <div className={`
              fixed top-0 bottom-0 left-0 md:relative md:top-auto md:bottom-auto md:left-auto
              z-40 h-full md:h-auto
              transition-transform duration-300 ease-in-out
              ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
              md:w-64 flex-shrink-0
            `}>
                <Sidebar 
                    activeTab={activeTab} 
                    onTabChange={handleTabChange} 
                    user={user}
                    walletConnected={isConnected}
                    onLogout={handleLogout}
                    onClose={() => setIsSidebarOpen(false)}
                />
            </div>
            <div className="flex-1 overflow-auto w-full">
                  {dashboardComponent}
            </div>
        </div>
        <div className="flex-1 overflow-auto">
          {React.cloneElement(dashboardComponent, { onStatsChange: setDashboardStats })}
        </div>
      </div>
    )
  }

  /* -------------------- Routes -------------------- */
  return (
    <ErrorBoundary>
      <Router>
        <NavigationSetup />
        <Toaster position="top" richColors />
        <div className="App">
          <Header 
              user={user} 
              onLogout={handleLogout} 
              walletConnected={isConnected}
              onUserUpdate={setUser}
              onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          />
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
              
              {/* ✅ PROTECTED: Seller */}
              <Route
                path="/seller"
                element={
                  <RequireAuth allowedRoles={['seller']}>
                    {renderDashboard(<SellerDashboard activeTab={activeTab} />)}
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
                className="fixed bottom-5 right-5 bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-opacity-50 transition-transform transform hover:scale-110 z-[1000]"
                aria-label="Toggle Chatbot"
              >
                {isChatbotOpen ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : '💬'}
              </button>
            </>
          )}
        </div>
      </Router>
    </ErrorBoundary>
  );
}

export default App;