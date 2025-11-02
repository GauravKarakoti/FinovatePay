import { useState, useEffect } from 'react';
import { api } from '../utils/api'; // Assuming you have a configured api utility
import { toast } from 'sonner';
import io from 'socket.io-client';

const InvoiceCard = ({ invoice, onInvest }) => {
    // Destructure the properties that actually exist in the invoice object
    const { invoice_id, amount, due_date, currency } = invoice;
    
    console.log("InvoiceCard props:", invoice);
    const [investmentAmount, setInvestmentAmount] = useState('');

    // --- FIX ---
    // Rename variables to match what the component's UI expects
    const face_value_display = amount; // The invoice 'amount' is its face value
    const maturity = new Date(due_date).toLocaleDateString(); // Use 'due_date'

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
            </div>
            {/* FIX: Use 'maturity' (derived from 'due_date') */}
            <p className="text-sm text-gray-600">Matures on: {maturity}</p>
            <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                    <span>Face Value:</span>
                    {/* FIX: Use 'face_value_display' (derived from 'amount') */}
                    <span className="font-medium">{currency} {face_value_display}</span>
                </div>
            </div>
            <div className="mt-4 flex space-x-2">
                <input
                    type="number"
                    placeholder="Amount"
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

const PortfolioItem = ({ item, onRedeem }) => {
    // --- START FIX ---
    // The item prop will now be an aggregated object  
    // Destructure the aggregated item
    const { invoice, total_tokens, holdings } = item;
    // Destructure from the nested invoice object
    const { invoice_id, due_date, status } = invoice;
    
    const maturity = new Date(due_date).toLocaleDateString();
    const isMatured = new Date(due_date) < new Date();
    // --- END FIX ---

    return (
        <div className="bg-white shadow rounded-lg p-4 flex justify-between items-center">
            <div>
                <h3 className="text-lg font-semibold">Invoice {invoice_id.substring(0, 8)}...</h3>
                {/* FIX: Display the aggregated 'total_tokens' */}
                <p className="text-sm text-gray-600">Tokens Owned: <span className="font-medium">{total_tokens}</span></p>
                <p className="text-sm text-gray-600">Maturity: {maturity}</p>
            </div>
            <button
                // FIX: Pass the full 'holdings' array to onRedeem
                onClick={() => onRedeem(holdings)}
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
            console.log("Raw portfolio data:", res.data);

            // --- START FIX: Aggregate portfolio data by invoice ---
            const holdings = new Map();
            res.data.forEach(item => {
                const { invoice, tokens_owned, token_id } = item;
                
                // Ensure invoice and invoice_id exist before proceeding
                if (!invoice || !invoice.invoice_id) {
                    console.warn("Skipping portfolio item with missing invoice data", item);
                    return; 
                }
                
                const invoiceId = invoice.invoice_id;
                const tokenAmount = parseFloat(tokens_owned);

                if (Number.isNaN(tokenAmount)) {
                     console.warn("Skipping portfolio item with invalid token amount", item);
                    return;
                }

                if (holdings.has(invoiceId)) {
                    const existing = holdings.get(invoiceId);
                    existing.total_tokens += tokenAmount;
                    existing.holdings.push({ token_id: token_id, amount: tokenAmount });
                } else {
                    holdings.set(invoiceId, {
                        invoice: invoice,
                        total_tokens: tokenAmount,
                        holdings: [{ token_id: token_id, amount: tokenAmount }],
                        // Use invoice_id as the unique key for the aggregated item
                        item_key: invoiceId 
                    });
                }
            });
            
            setPortfolio(Array.from(holdings.values()));
            // --- END FIX ---

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

    const handleRedeem = async (holdingsToRedeem) => { // 'holdingsToRedeem' is an array: [{token_id, amount}, ...]
        toast.loading('Redeeming all tokens for this invoice...');
        let totalRedeemedValue = 0;
        let failedRedemptions = 0;
        let successfulRedemptions = 0;

        try {
            // Loop over each individual holding and redeem it
            for (const holding of holdingsToRedeem) {
                // Skip if amount is zero or negative
                if (holding.amount <= 0) continue; 
                
                try {
                    const res = await api.post('/investor/redeem-tokens', { 
                        tokenId: holding.token_id, 
                        amount: holding.amount 
                    });
                    // Assuming res.data.redeemed_value is a number or string convertible to number
                    totalRedeemedValue += parseFloat(res.data.redeemed_value) || 0;
                    successfulRedemptions++;
                } catch (error) {
                    failedRedemptions++;
                    console.error(`Failed to redeem token ${holding.token_id}`, error);
                    toast.error(error.response?.data?.msg || `Failed to redeem part of holding (Token ${holding.token_id.substring(0, 6)}...)`);
                }
            }

            // Report final status
            if (successfulRedemptions > 0 && failedRedemptions === 0) {
                toast.success(`Successfully redeemed ${totalRedeemedValue.toFixed(2)} USD`);
            } else if (successfulRedemptions > 0 && failedRedemptions > 0) {
                toast.warning(`Partially redeemed ${totalRedeemedValue.toFixed(2)} USD. ${failedRedemptions} parts failed.`);
            } else if (successfulRedemptions === 0 && failedRedemptions > 0) {
                toast.error('All redemption attempts failed.');
            } else {
                // This case (0 success, 0 fails) might happen if holdings array was empty or all amounts were 0
                toast.info('No tokens to redeem.');
            }
            
            fetchPortfolio(); // Refresh portfolio regardless of outcome
        } catch (error) {
            // Catch any unexpected error in the looping logic itself
            toast.error('An unexpected error occurred during the redemption process.');
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

            <div>
                <h2 className="text-2xl font-semibold mb-4">My Portfolio</h2>
                <div className="space-y-4">
                     {portfolio.length > 0 ? (
                        portfolio.map(item => (
                            <PortfolioItem 
                                key={item.item_key} // FIX: Use the aggregated item_key
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