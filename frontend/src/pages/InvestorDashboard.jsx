import { useState, useEffect } from 'react';
import { api } from '../utils/api'; // Assuming you have a configured api utility
import { toast } from 'sonner';
import io from 'socket.io-client';
// --- IMPORT NEW WEB3 FUNCTIONS AND UTILS ---
import { getFractionTokenContract } from '../utils/web3';
import { ethers } from 'ethers';

const InvoiceCard = ({ invoice, onInvest }) => {
    // --- UPDATED: Destructured remaining_supply ---
    const { invoice_id, amount, due_date, currency, remaining_supply } = invoice;

    console.log("InvoiceCard props:", invoice);
    const [investmentAmount, setInvestmentAmount] = useState('');

    const face_value_display = amount; 
    const maturity = new Date(due_date).toLocaleDateString();

    const handleInvest = () => {
        if (!investmentAmount || +investmentAmount <= 0) {
            return toast.error("Please enter a valid amount to invest");
        }
        onInvest(invoice, investmentAmount);
        setInvestmentAmount('');
    };

    return (
        <div className="bg-white shadow rounded-lg p-4 border border-gray-200">
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold text-finovate-blue-800">Invoice {invoice_id.substring(0, 8)}...</h3>
            </div>
            <p className="text-sm text-gray-600">Matures on: {maturity}</p>
            <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                    <span>Face Value:</span>
                    {/* Display currency as MATIC if it's the chain's native token */}
                    <span className="font-medium">{currency === 'MATIC' ? 'MATIC' : currency} {face_value_display}</span>
                </div>
                {/* --- ADDED: Remaining Value Section --- */}
                <div className="flex justify-between text-sm">
                    <span>Remaining to Invest:</span>
                    <span className="font-medium text-green-600">
                        {currency === 'MATIC' ? 'MATIC' : currency} {Number(remaining_supply)}
                    </span>
                </div>
            </div>
            <div className="mt-4 flex space-x-2">
                <input
                    type="number"
                    placeholder="Amount in MATIC" // <-- Updated placeholder
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
    const { invoice, total_tokens, holdings } = item;
    const { invoice_id, due_date, status } = invoice;

    const maturity = new Date(due_date).toLocaleDateString();
    const isMatured = new Date(due_date) < new Date();

    return (
        <div className="bg-white shadow rounded-lg p-4 flex justify-between items-center">
            <div>
                <h3 className="text-lg font-semibold">Invoice {invoice_id.substring(0, 8)}...</h3>
                {/* We use total_tokens which is a human-readable sum */}
                <p className="text-sm text-gray-600">Tokens Owned: <span className="font-medium">{total_tokens.toFixed(4)}</span></p>
                <p className="text-sm text-gray-600">Maturity: {maturity}</p>
            </div>
            <button
                onClick={() => onRedeem(holdings, invoice)} // <-- Pass invoice for context
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
        const socket = io(import.meta.env.VITE_API_URL); // Your backend URL
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
            setMarketplaceListings(res.data.filter(inv => inv.currency === 'MATIC'));
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

            const holdings = new Map();
            res.data.forEach(item => {
                const { invoice, tokens_owned, token_id } = item;

                if (!invoice || !invoice.invoice_id) {
                    console.warn("Skipping portfolio item with missing invoice data", item);
                    return;
                }
                
                // Only show portfolio items for MATIC invoices
                if (invoice.currency !== 'MATIC') {
                    return;
                }

                const invoiceId = invoice.invoice_id;
                // Use parseFloat for summing, as this is for display
                const tokenAmount = parseFloat(tokens_owned); 

                if (Number.isNaN(tokenAmount) || tokenAmount <= 0) {
                    console.warn("Skipping portfolio item with invalid token amount", item);
                    return;
                }

                if (holdings.has(invoiceId)) {
                    const existing = holdings.get(invoiceId);
                    existing.total_tokens += tokenAmount;
                    // Store the raw string value for accurate redemption
                    existing.holdings.push({ token_id: token_id, amount: tokens_owned }); 
                } else {
                    holdings.set(invoiceId, {
                        invoice: invoice,
                        total_tokens: tokenAmount,
                        // Store the raw string value for accurate redemption
                        holdings: [{ token_id: token_id, amount: tokens_owned }],
                        item_key: invoiceId
                    });
                }
            });

            setPortfolio(Array.from(holdings.values()));
        } catch (error) {
            toast.error('Failed to load portfolio.');
            console.error(error);
        }
    };

    const handleInvest = async (invoice, amountToInvest) => {
        const PLATFORM_TREASURY_WALLET = import.meta.env.VITE_PLATFORM_TREASURY_ADDRESS;

        if (!PLATFORM_TREASURY_WALLET) {
            toast.error("Platform treasury address is not configured. Please contact support.");
            return;
        }
        
        console.log("Starting investment process for invoice:", invoice, "Amount:", amountToInvest);
        // This is a critical assumption about your tokenization logic:
        // That 1 MATIC = 1 Token (or 1 WEI = 1 Token unit)
        // And that `invoice.face_value` and `invoice.total_supply` are set accordingly in the contract
        if (!invoice.amount) {
            toast.error("Invoice is missing token supply or face value. Cannot calculate price.");
            return;
        }

        let fractionToken;
        let tokenId;

        try {
            toast.loading('Preparing transaction... Please check your wallet.');
            
            fractionToken = await getFractionTokenContract();
            tokenId = invoice.token_id;
            
            // 1. Convert human-readable MATIC amount (e.g., "100") to WEI
            // This is the amount of tokens to buy (assuming 1:1)
            const tokenAmount = ethers.utils.parseEther(amountToInvest);
            
            // 2. The payment amount is the same as the token amount (1:1 price)
            const paymentAmount = tokenAmount;

            // 3. Remove all Allowance and Approval logic
            toast.loading('Please confirm the transaction in your wallet...');
            console.log("Calling purchaseTokens");
            // 4. Call the purchaseTokens function
            const tx = await fractionToken.purchaseTokens(
                tokenId,
                tokenAmount, // The amount of ERC1155 tokens (in WEI)
                PLATFORM_TREASURY_WALLET, // The address that holds the tokens
                {
                    value: paymentAmount // The amount of MATIC to send
                }
            );

            await tx.wait();
            toast.success('Investment successful! Transaction confirmed.');

            // 5. Notify backend to *record* the investment
            await api.post('/investor/record-investment', {
                invoiceId: invoice.invoice_id,
                amountInvested: amountToInvest, // The human-readable amount
                tokenId: tokenId,
                txHash: tx.hash
            });

            // 6. Refetch data
            fetchMarketplace();
            fetchPortfolio();

        } catch (error) {
            console.error(error);
            if (error.code === 4001) { // User rejected transaction
                toast.error('Transaction rejected in wallet.');
            } else if (error.reason?.includes("Incorrect MATIC value sent")) {
                toast.error("Transaction failed: Incorrect MATIC value.");
            } else if (error.reason?.includes("insufficient funds")) {
                toast.error("Payment failed. Do you have enough MATIC?");
            } else if (error.reason?.includes("transfer failed")) {
                toast.error("Platform treasury is empty or cannot transfer tokens.");
            } else {
                toast.error(error.reason || 'Investment failed. See console for details.');
            }
        }
    };

    const handleRedeem = async (holdingsToRedeem, invoice) => { // 'holdingsToRedeem' is an array: [{token_id, amount (string)}, ...]
        
        toast.loading('Redeeming all tokens for this invoice... Please check your wallet.');
        
        let totalRedeemedValue = ethers.BigNumber.from(0);
        let successfulRedemptions = 0;
        let failedRedemptions = 0;
        const txHashes = [];

        try {
            const fractionToken = await getFractionTokenContract();
            
            for (const holding of holdingsToRedeem) {
                // holding.amount is the raw string "100.00" from the DB
                if (!holding.amount || parseFloat(holding.amount) <= 0) continue; 
                
                try {
                    // Convert the human-readable string amount to WEI (BigNumber)
                    const tokenAmountToRedeem = ethers.utils.parseEther(holding.amount);
                    
                    if (tokenAmountToRedeem.isZero()) continue;

                    const tx = await fractionToken.redeem(holding.token_id, tokenAmountToRedeem);
                    const receipt = await tx.wait();
                    txHashes.push(receipt.transactionHash);

                    // Parse the event from logs to find out the redeemed MATIC value
                    const redeemEvent = receipt.events?.find(e => e.event === 'Redeemed');
                    if (redeemEvent) {
                        totalRedeemedValue = totalRedeemedValue.add(redeemEvent.args.amount);
                    }
                    successfulRedemptions++;

                } catch (error) {
                     failedRedemptions++;
                     console.error(error);
                     toast.error(error.reason || `Failed to redeem token ${holding.token_id}`);
                }
            }

            // After the loop, report final status
            const totalRedeemedMatic = ethers.utils.formatEther(totalRedeemedValue);

            if (successfulRedemptions > 0) {
                toast.success(`Successfully redeemed ${totalRedeemedMatic} MATIC.`);
                
                // --- Notify backend to record the redemption ---
                // You must create this backend endpoint!
                try {
                    await api.post('/investor/record-redemption', {
                        invoiceId: invoice.invoice_id,
                        redeemedAmount: totalRedeemedMatic, // Human-readable MATIC
                        txHashes: txHashes
                    });
                } catch (apiError) {
                    toast.error("Failed to record redemption in backend. Please contact support.");
                }
            }

            if (failedRedemptions > 0) {
                toast.warning(`${failedRedemptions} redemption attempts failed.`);
            }
            
            if (successfulRedemptions === 0 && failedRedemptions === 0) {
                 toast.info('No tokens were available to redeem.');
            }

            fetchPortfolio(); // Refresh portfolio regardless of outcome

        } catch (error) {
            console.error(error);
            if (error.code === 4001) { // User rejected transaction
                toast.error('Transaction rejected in wallet.');
            } else {
                toast.error('An unexpected error occurred. See console.');
            }
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
                        !isLoading && <p>No MATIC invoices currently listed for financing.</p>
                    )}
                </div>
            </div>

            {/* Column 2: Portfolio */}
            <div>
                <h2 className="text-2xl font-semibold mb-4">My Portfolio (MATIC)</h2>
                <div className="space-y-4">
                    {portfolio.length > 0 ? (
                        portfolio.map(item => (
                            <PortfolioItem
                                key={item.item_key}
                                item={item}
                                onRedeem={handleRedeem}
                            />
                        ))
                    ) : (
                        <p>You have not invested in any MATIC invoices yet.</p>
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
                    <p>Welcome to your investor dashboard. Select 'Financing' to view the marketplace.</p>
                </div>
            )}

            {activeTab === 'financing' && renderFinancingContent()}
        </div>
    );
};

export default InvestorDashboard;