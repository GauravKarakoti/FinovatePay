import { useState, useEffect } from 'react';
import { api } from '../utils/api'; // Assuming you have a configured api utility
import { toast } from 'sonner';
import io from 'socket.io-client';

// Helper component for a single invoice card
const InvoiceCard = ({ invoice, onInvest }) => {
    const { invoice_id, amount, face_value, maturity_date, remaining_supply, currency } = invoice;
    const [investmentAmount, setInvestmentAmount] = useState('');

    const potentialYield = ((face_value - amount) / amount * 100).toFixed(2);
    const maturity = new Date(maturity_date).toLocaleDateString();

    const handleInvest = () => {
        if (!investmentAmount || +investmentAmount <= 0) {
            return toast.error("Please enter a valid amount to invest");
        }
        onInvest(invoice_id, investmentAmount);
        setInvestmentAmount('');
    };

    return (
        <div className="bg-white shadow rounded-lg p-4 border border-gray-200">
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold text-finovate-blue-800">Invoice {invoice_id.substring(0, 8)}...</h3>
                <span className="text-sm font-medium text-green-600">Yield: {potentialYield}%</span>
            </div>
            <p className="text-sm text-gray-600">Matures on: {maturity}</p>
            <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                    <span>Face Value:</span>
                    <span className="font-medium">{currency} {face_value}</span>
                </div>
                <div className="flex justify-between text-sm">
                    <span>Amount Remaining:</span>
                    <span className="font-medium">{currency} {remaining_supply || 'N/A'}</span>
                </div>
            </div>
            <div className="mt-4 flex space-x-2">
                <input
                    type="number"
                    placeholder="Amount (USD)"
                    value={investmentAmount}
                    onChange={(e) => setInvestmentAmount(e.target.value)}
                    className="flex-1 p-2 border rounded-md text-sm"
                />
                <button
                    onClick={handleInvest}
                    className="bg-finovate-blue-600 text-white px-4 py-2 rounded-md hover:bg-finovate-blue-700 text-sm"
                >
                    Invest
                </button>
            </div>
        </div>
    );
};

// Helper component for portfolio item
const PortfolioItem = ({ item, onRedeem }) => {
    const { invoice_id, tokens_owned, face_value, maturity_date, status } = item;
    const maturity = new Date(maturity_date).toLocaleDateString();
    const isMatured = new Date(maturity_date) < new Date();

    return (
        <div className="bg-white shadow rounded-lg p-4 flex justify-between items-center">
            <div>
                <h3 className="text-lg font-semibold">Invoice {invoice_id.substring(0, 8)}...</h3>
                <p className="text-sm text-gray-600">Tokens Owned: <span className="font-medium">{tokens_owned}</span></p>
                <p className="text-sm text-gray-600">Maturity: {maturity}</p>
            </div>
            <button
                onClick={() => onRedeem(item.token_id, tokens_owned)}
                disabled={!isMatured || status === 'redeemed'}
                className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:bg-gray-400"
            >
                {status === 'redeemed' ? 'Redeemed' : (isMatured ? 'Redeem' : 'Matures ' + maturity)}
            </button>
        </div>
    );
};


const InvestorDashboard = ({ activeTab }) => {
    const [marketplaceListings, setMarketplaceListings] = useState([]);
    const [portfolio, setPortfolio] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    
    // Setup Socket.IO
    useEffect(() => {
        const socket = io(import.meta.env.VITE_API_BASE_URL); // Your backend URL
        socket.emit('join-marketplace');

        socket.on('new-listing', (newInvoice) => {
            toast.info(`New invoice listed for financing: ${newInvoice.invoice_id}`);
            setMarketplaceListings(prev => [newInvoice, ...prev]);
        });

        socket.on('investment-made', ({ invoiceId, newSupply }) => {
            // Update the supply on the specific invoice card
            setMarketplaceListings(prev => 
                prev.map(inv => 
                    inv.invoice_id === invoiceId ? { ...inv, remaining_supply: newSupply } : inv
                )
            );
        });

        return () => socket.disconnect();
    }, []);

    // Fetch data when activeTab changes
    useEffect(() => {
        if (activeTab === 'financing') {
            fetchMarketplace();
            fetchPortfolio();
        }
    }, [activeTab]);

    const fetchMarketplace = async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/financing/marketplace');
            setMarketplaceListings(res.data);
        } catch (error) {
            toast.error('Failed to load marketplace listings.');
            console.error(error);
        }
        setIsLoading(false);
    };

    const fetchPortfolio = async () => {
        try {
            const res = await api.get('/investor/portfolio');
            setPortfolio(res.data);
        } catch (error) {
            toast.error('Failed to load portfolio.');
            console.error(error);
        }
    };

    const handleInvest = async (invoiceId, amountToInvest) => {
        toast.loading('Processing investment...');
        try {
            const res = await api.post('/investor/buy-tokens', { invoiceId, amountToInvest });
            toast.success(res.data.msg || 'Investment successful!');
            // Refetch data
            fetchMarketplace();
            fetchPortfolio();
        } catch (error) {
            toast.error(error.response?.data?.msg || 'Investment failed.');
            console.error(error);
        }
    };

    const handleRedeem = async (tokenId, amount) => {
        toast.loading('Redeeming tokens...');
        try {
            const res = await api.post('/investor/redeem-tokens', { tokenId, amount });
            toast.success(`Successfully redeemed ${res.data.redeemed_value} USD`);
            fetchPortfolio(); // Refresh portfolio
        } catch (error) {
            toast.error(error.response?.data?.msg || 'Redemption failed.');
            console.error(error);
        }
    };
    
    // Render financing tab content
    const renderFinancingContent = () => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Column 1: Marketplace */}
            <div>
                <h2 className="text-2xl font-semibold mb-4">Invoice Marketplace</h2>
                {isLoading && <p>Loading listings...</p>}
                <div className="space-y-4">
                    {marketplaceListings.length > 0 ? (
                        marketplaceListings.map(invoice => (
                            <InvoiceCard 
                                key={invoice.invoice_id} 
                                invoice={invoice}
                                onInvest={handleInvest} 
                            />
                        ))
                    ) : (
                        !isLoading && <p>No invoices currently listed for financing.</p>
                    )}
                </div>
            </div>

            {/* Column 2: My Portfolio */}
            <div>
                <h2 className="text-2xl font-semibold mb-4">My Portfolio</h2>
                <div className="space-y-4">
                     {portfolio.length > 0 ? (
                        portfolio.map(item => (
                            <PortfolioItem 
                                key={item.token_id} 
                                item={item} 
                                onRedeem={handleRedeem}
                            />
                        ))
                     ) : (
                        <p>You have not invested in any invoices yet.</p>
                     )}
                </div>
            </div>
        </div>
    );

    // Main render logic for the dashboard
    return (
        <div className="p-6">
            {activeTab === 'overview' && (
                <div>
                    <h1 className="text-3xl font-semibold mb-6">Investor Overview</h1>
                    {/* Add overview stats for investors here */}
                    <p>Welcome to your investor dashboard. Select 'Financing' to view the marketplace.</p>
                </div>
            )}

            {activeTab === 'financing' && renderFinancingContent()}

            {/* Other tabs can be added here */}
        </div>
    );
};

export default InvestorDashboard;