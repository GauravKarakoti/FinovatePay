import { useState, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { api } from '../utils/api';
import { toast } from 'sonner';
import io from 'socket.io-client';
import { ethers } from 'ethers';

import FiatOnRampModal from '../components/Dashboard/FiatOnRampModal';
import { getFractionTokenContract, stablecoinAddresses } from '../utils/web3';
import { BuyFractionToken } from '../components/Financing/BuyFractionToken';
import { useStatsActions } from '../context/StatsContext';
import AuctionList from '../components/Auction/AuctionList';
import AnalyticsPage from './AnalyticsPage';

// --- Reusable UI Components ---

const LoadingSpinner = ({ size = 'md' }) => {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <div className="flex items-center justify-center py-12">
      <div className={`animate-spin rounded-full border-b-2 border-blue-600 ${sizes[size]}`} role="status">
        <span className="sr-only">Loading...</span>
      </div>
    </div>
  );
};

LoadingSpinner.propTypes = { size: PropTypes.oneOf(['sm', 'md', 'lg']) };

const EmptyState = ({ message, icon = '📭', action = null }) => (
  <div className="text-center py-12 px-4 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
    <div className="text-4xl mb-3">{icon}</div>
    <p className="text-gray-500 font-medium mb-2">{message}</p>
    {action && (
      <button 
        onClick={action.onClick}
        className="text-blue-600 hover:text-blue-700 text-sm font-medium mt-2"
      >
        {action.label}
      </button>
    )}
  </div>
);

EmptyState.propTypes = {
  message: PropTypes.string.isRequired,
  icon: PropTypes.string,
  action: PropTypes.shape({
    label: PropTypes.string,
    onClick: PropTypes.func
  })
};

const ActionButton = ({ 
  onClick, 
  children, 
  variant = 'primary', 
  disabled = false, 
  loading = false,
  className = '' 
}) => {
  const baseClasses = "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    success: "bg-green-600 text-white hover:bg-green-700 shadow-sm",
    danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
    secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200",
    outline: "border-2 border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50"
  };
  
  return (
    <button 
      onClick={onClick} 
      disabled={disabled || loading}
      className={`${baseClasses} ${variants[variant]} ${className}`}
    >
      {loading && <span className="animate-spin">⏳</span>}
      {children}
    </button>
  );
};

ActionButton.propTypes = {
  onClick: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(['primary', 'success', 'danger', 'secondary', 'outline']),
  disabled: PropTypes.bool,
  loading: PropTypes.bool,
  className: PropTypes.string
};

const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden ${className}`}>
    {children}
  </div>
);

Card.propTypes = { children: PropTypes.node, className: PropTypes.string };

// --- Feature Components ---

const InvoiceCard = ({ invoice, onPurchaseSuccess }) => {
  const { invoice_id, amount, due_date, currency, remaining_supply, token_id } = invoice;

  const maturity = useMemo(() => new Date(due_date).toLocaleDateString(), [due_date]);
  
  const stablecoinConfig = useMemo(() => {
    const isNative = currency === 'MATIC' || currency === 'ETH';
    const address = stablecoinAddresses[currency] || stablecoinAddresses["USDC"];
    const isUSDC = address === stablecoinAddresses["USDC"];
    return {
      address,
      decimals: isUSDC ? 6 : 18,
      isNative
    };
  }, [currency]);

  return (
    <Card className="p-5 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Invoice #{invoice_id.substring(0, 8)}...
          </h3>
          <p className="text-sm text-gray-500 mt-1">Matures: {maturity}</p>
        </div>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          {currency}
        </span>
      </div>
      
      <div className="space-y-2 mb-5 bg-gray-50 p-3 rounded-lg">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Face Value:</span>
          <span className="font-semibold text-gray-900">{amount} {currency}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Available:</span>
          <span className="font-semibold text-green-600">
            {Number(remaining_supply).toFixed(2)} {currency}
          </span>
        </div>
      </div>

      <BuyFractionToken
        tokenId={token_id}
        stablecoinAddress={stablecoinConfig.address}
        stablecoinDecimals={stablecoinConfig.decimals}
        tokenDecimals={18}
        maxAmount={remaining_supply}
        onSuccess={onPurchaseSuccess}
      />
    </Card>
  );
};

InvoiceCard.propTypes = {
  invoice: PropTypes.shape({
    invoice_id: PropTypes.string.isRequired,
    amount: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    due_date: PropTypes.string.isRequired,
    currency: PropTypes.string.isRequired,
    remaining_supply: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    token_id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired
  }).isRequired,
  onPurchaseSuccess: PropTypes.func.isRequired
};

const PortfolioItem = ({ item, onRedeem, isRedeeming }) => {
  const { invoice, total_tokens, holdings } = item;
  const { invoice_id, due_date, status, currency } = invoice;

  const maturity = useMemo(() => new Date(due_date).toLocaleDateString(), [due_date]);
  const isMatured = useMemo(() => new Date() >= new Date(due_date), [due_date]);
  
  const canRedeem = isMatured && status !== 'redeemed' && !isRedeeming;
  const statusText = status === 'redeemed' ? 'Redeemed' : (isMatured ? 'Ready' : 'Pending');
  const statusColor = status === 'redeemed' ? 'bg-gray-100 text-gray-600' : 
                      isMatured ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700';

  const handleRedeem = useCallback(() => {
    if (!canRedeem) return;
    onRedeem(holdings, invoice);
  }, [canRedeem, holdings, invoice, onRedeem]);

  return (
    <Card className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-lg font-semibold text-gray-900">Invoice #{invoice_id.substring(0, 8)}...</h3>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
            {statusText}
          </span>
        </div>
        <div className="space-y-1 text-sm text-gray-600">
          <p>Tokens: <span className="font-medium text-gray-900">{Number(total_tokens).toFixed(4)}</span></p>
          <p>Maturity: <span className="font-medium">{maturity}</span></p>
        </div>
      </div>
      
      <ActionButton
        onClick={handleRedeem}
        variant={status === 'redeemed' ? 'secondary' : 'success'}
        disabled={!canRedeem}
        loading={isRedeeming}
        className="w-full sm:w-auto whitespace-nowrap"
      >
        {isRedeeming ? 'Processing...' : 
         status === 'redeemed' ? 'Redeemed' : 
         isMatured ? 'Redeem Now' : 'Not Matured'}
      </ActionButton>
    </Card>
  );
};

PortfolioItem.propTypes = {
  item: PropTypes.shape({
    invoice: PropTypes.shape({
      invoice_id: PropTypes.string.isRequired,
      due_date: PropTypes.string.isRequired,
      status: PropTypes.string.isRequired,
      currency: PropTypes.string.isRequired
    }).isRequired,
    total_tokens: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    holdings: PropTypes.arrayOf(PropTypes.shape({
      token_id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      amount: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired
    })).isRequired,
    item_key: PropTypes.string.isRequired
  }).isRequired,
  onRedeem: PropTypes.func.isRequired,
  isRedeeming: PropTypes.bool
};

// --- Main Dashboard Component ---

const InvestorDashboard = ({ activeTab = 'overview' }) => {
  const [marketplaceListings, setMarketplaceListings] = useState([]);
  const [portfolio, setPortfolio] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [showFiatModal, setShowFiatModal] = useState(false);
  const [socket, setSocket] = useState(null);
  const { setStats: setGlobalStats } = useStatsActions();

  // Initialize Socket.IO with authentication
  useEffect(() => {
    const token = localStorage.getItem('token');
    
    if (!token) {
      console.error('No authentication token found');
      return;
    }

    const newSocket = io(import.meta.env.VITE_API_URL, {
      auth: {
        token: token
      }
    });

    setSocket(newSocket);

    // Handle connection success
    newSocket.on('connect', () => {
      console.log('Socket connected successfully');
      newSocket.emit('join-marketplace');
    });

    // Handle authentication errors
    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
      if (error.message.includes('Authentication') || error.message.includes('token')) {
        toast.error('Authentication failed. Please login again.');
      }
    });

    // Handle authorization errors
    newSocket.on('error', (error) => {
      console.error('Socket error:', error);
      toast.error(error.message || 'Socket connection error');
    });

    // Handle successful room join
    newSocket.on('joined-marketplace', () => {
      console.log('Successfully joined marketplace room');
    });

    newSocket.on('new-listing', (newInvoice) => {
      toast.info(`New invoice listed: ${newInvoice.invoice_id.substring(0, 8)}...`);
      setMarketplaceListings(prev => [newInvoice, ...prev]);
    });

    newSocket.on('investment-made', ({ invoiceId, newSupply }) => {
      setMarketplaceListings(prev =>
        prev.map(inv =>
          inv.invoice_id === invoiceId ? { ...inv, remaining_supply: newSupply } : inv
        )
      );
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Handle URL payment callbacks
  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const paymentStatus = queryParams.get('payment');
    const amount = queryParams.get('amount');

    if (paymentStatus === 'success' && amount) {
      toast.success(`Payment successful! Added ${amount} USDC to your wallet.`);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (paymentStatus === 'cancelled') {
      toast.info('Payment process was cancelled.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const fetchMarketplace = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/financing/marketplace');
      setMarketplaceListings(res.data || []);
    } catch (error) {
      console.error('Failed to load marketplace:', error);
      toast.error('Failed to load marketplace listings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await api.get('/investor/portfolio');
      const holdings = new Map();
      
      (res.data || []).forEach(item => {
        const { invoice, tokens_owned, token_id } = item;
        if (!invoice?.invoice_id) return;
        
        const invoiceId = invoice.invoice_id;
        const tokenAmount = parseFloat(tokens_owned);

        if (Number.isNaN(tokenAmount) || tokenAmount <= 0) return;

        if (holdings.has(invoiceId)) {
          const existing = holdings.get(invoiceId);
          existing.total_tokens += tokenAmount;
          existing.holdings.push({ token_id, amount: tokens_owned });
        } else {
          holdings.set(invoiceId, {
            invoice,
            total_tokens: tokenAmount,
            holdings: [{ token_id, amount: tokens_owned }],
            item_key: invoiceId
          });
        }
      });

      setPortfolio(Array.from(holdings.values()));
    } catch (error) {
      console.error('Failed to load portfolio:', error);
      toast.error('Failed to load portfolio');
    }
  }, []);
  
  useEffect(() => {
    fetchMarketplace();
    fetchPortfolio();
  }, [fetchMarketplace, fetchPortfolio]);

  // Sync global stats
  useEffect(() => {
    const active = portfolio.filter(p => p.invoice && p.invoice.status !== 'redeemed' && p.invoice.status !== 'cancelled').length;
    const completed = portfolio.filter(p => p.invoice && p.invoice.status === 'redeemed').length;
    
    setGlobalStats({
      totalInvoices: marketplaceListings.length,
      activeEscrows: active,
      completed: completed
    });
  }, [marketplaceListings, portfolio, setGlobalStats]);

  const handlePurchaseSuccess = useCallback(() => {
    fetchMarketplace();
    fetchPortfolio();
    toast.success('Investment successful! Portfolio updated.');
  }, [fetchMarketplace, fetchPortfolio]);

  const handleRedeem = useCallback(async (holdingsToRedeem, invoice) => {
    if (!window.confirm(`Redeem tokens for Invoice #${invoice.invoice_id.substring(0, 8)}...? This will transfer proceeds to your wallet.`)) {
      return;
    }

    setIsRedeeming(true);
    const toastId = toast.loading('Processing redemption...');
    
    let totalRedeemedValue = 0n;
    let successfulRedemptions = 0;
    let failedRedemptions = 0;
    const txHashes = [];

    try {
      const fractionToken = await getFractionTokenContract();
      
      for (const holding of holdingsToRedeem) {
        if (!holding.amount || parseFloat(holding.amount) <= 0) continue;
        
        try {
          const tokenAmountToRedeem = ethers.parseEther(holding.amount.toString());
          if (tokenAmountToRedeem === 0n) continue;

          const tx = await fractionToken.redeem(holding.token_id, tokenAmountToRedeem);
          const receipt = await tx.wait();
          txHashes.push(receipt.transactionHash);

          const redeemEvent = receipt.events?.find(e => e.event === 'Redeemed');
          if (redeemEvent) {
            const redeemedAmount = redeemEvent.args?.amount ?? redeemEvent.args?.[2];
            if (redeemedAmount !== undefined) {
              totalRedeemedValue += redeemedAmount;
            }
          }
          successfulRedemptions++;
        } catch (error) {
          failedRedemptions++;
          console.error(`Redemption failed for token ${holding.token_id}:`, error);
        }
      }

      const totalRedeemedReadable = ethers.formatEther(totalRedeemedValue);

      if (successfulRedemptions > 0) {
        toast.success(`Redeemed ${parseFloat(totalRedeemedReadable).toFixed(4)} ${invoice.currency}`, { id: toastId });
        
        // Sync with backend
        try {
          await api.post('/investor/record-redemption', {
            invoiceId: invoice.invoice_id,
            redeemedAmount: totalRedeemedReadable,
            txHashes
          });
        } catch (apiError) {
          console.error("Backend sync failed:", apiError);
        }
      } else {
        toast.dismiss(toastId);
      }

      if (failedRedemptions > 0) {
        toast.error(`${failedRedemptions} redemption(s) failed`);
      }
      
      fetchPortfolio();
    } catch (error) {
      console.error('Redemption error:', error);
      toast.dismiss(toastId);
      if (error.code === 4001) {
        toast.error('Transaction rejected');
      } else {
        toast.error(error.reason || 'Redemption failed');
      }
    } finally {
      setIsRedeeming(false);
    }
  }, [fetchPortfolio]);

  // Tab Content Components
  const OverviewTab = () => (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-8 text-white shadow-lg">
        <h1 className="text-3xl font-bold mb-2">Welcome to the Marketplace</h1>
        <p className="text-blue-100 text-lg mb-6">
          Invest in tokenized invoices and earn yields from verified sellers.
        </p>
        <div className="flex flex-wrap gap-4">
          <ActionButton 
            onClick={() => document.getElementById('financing-tab')?.click()}
            variant="secondary"
            className="bg-white text-blue-600 hover:bg-blue-50"
          >
            Browse Marketplace
          </ActionButton>
          <ActionButton 
            onClick={() => setShowFiatModal(true)}
            variant="outline"
            className="border-white text-white hover:bg-white/10"
          >
            Buy Stablecoins
          </ActionButton>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6">
          <div className="text-3xl mb-2">📈</div>
          <h3 className="font-semibold text-gray-900 mb-1">High Yields</h3>
          <p className="text-sm text-gray-600">Earn attractive returns on short-term invoice financing.</p>
        </Card>
        <Card className="p-6">
          <div className="text-3xl mb-2">🔒</div>
          <h3 className="font-semibold text-gray-900 mb-1">Secure</h3>
          <p className="text-sm text-gray-600">Blockchain-secured investments with smart contract escrow.</p>
        </Card>
        <Card className="p-6">
          <div className="text-3xl mb-2">⚡</div>
          <h3 className="font-semibold text-gray-900 mb-1">Liquid</h3>
          <p className="text-sm text-gray-600">Trade fraction tokens or hold to maturity.</p>
        </Card>
      </div>
    </div>
  );

const FinancingTab = () => (
    <div className="space-y-8">
      {/* Header with Buy Button */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Invoice Marketplace</h2>
          <p className="text-sm text-gray-500 mt-1">Available investment opportunities</p>
        </div>
        <ActionButton 
          onClick={() => setShowFiatModal(true)}
          variant="success"
          className="w-full sm:w-auto"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Buy Stablecoins
        </ActionButton>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Marketplace Column */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 sticky top-0 bg-gray-50 py-2 z-10">
            Available Listings ({marketplaceListings.length})
          </h3>
          
          {isLoading ? (
            <LoadingSpinner />
          ) : marketplaceListings.length > 0 ? (
            <div className="space-y-4">
              {marketplaceListings.map(invoice => (
                <InvoiceCard
                  key={invoice.invoice_id}
                  invoice={invoice}
                  onPurchaseSuccess={handlePurchaseSuccess}
                />
              ))}
            </div>
          ) : (
            <EmptyState 
              message="No invoices currently listed for financing" 
              icon="📭"
              action={{ label: 'Refresh', onClick: fetchMarketplace }}
            />
          )}
        </div>

        {/* Portfolio Column */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 sticky top-0 bg-gray-50 py-2 z-10">
            My Portfolio ({portfolio.length})
          </h3>
          
          {portfolio.length > 0 ? (
            <div className="space-y-4">
              {portfolio.map(item => (
                <PortfolioItem
                  key={item.item_key}
                  item={item}
                  onRedeem={handleRedeem}
                  isRedeeming={isRedeeming}
                />
              ))}
            </div>
          ) : (
            <EmptyState 
              message="You haven't invested in any invoices yet" 
              icon="💼"
              action={{ label: 'Browse Marketplace', onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            />
          )}
        </div>
      </div>
    </div>
  );

  // Auction Tab Component
  const AuctionTab = () => (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Invoice Auctions</h2>
          <p className="text-sm text-gray-500 mt-1">Bid on invoices for best yield rates</p>
        </div>
      </div>

      {/* Info Card */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="text-blue-600 text-xl">🏷️</div>
          <div>
            <h3 className="font-medium text-blue-900">How Invoice Auctions Work</h3>
            <ul className="text-sm text-blue-700 mt-2 space-y-1">
              <li>• <strong>Sellers:</strong> List invoices for auction with minimum yield requirements</li>
              <li>• <strong>Investors:</strong> Place bids offering lower yields (better for seller)</li>
              <li>• <strong>Winner:</strong> Lowest yield bidder wins and pays the invoice</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Auction List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Active Auctions</h3>
        </div>
        <div className="p-4">
          <AuctionList userRole="investor" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Tab Content */}
        <main className="animate-fadeIn">
{activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'financing' && <FinancingTab />}
          {activeTab === 'auctions' && <AuctionTab />}
          {activeTab === 'analytics' && <AnalyticsPage activeTab={activeTab} />}
          {activeTab !== 'overview' && activeTab !== 'financing' && activeTab !== 'auctions' && activeTab !== 'analytics' && (
            <EmptyState message="Section under construction" icon="🚧" />
          )}
        </main>
      </div>

      {/* Fiat On-Ramp Modal */}
      {showFiatModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-fadeIn">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Buy Stablecoins</h3>
              <button 
                onClick={() => setShowFiatModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>
            <FiatOnRampModal 
              onClose={() => setShowFiatModal(false)}
              onSuccess={(amount) => {
                toast.success(`Successfully purchased ${amount} USDC`);
                setShowFiatModal(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

InvestorDashboard.propTypes = {
  activeTab: PropTypes.string
};

export default InvestorDashboard;