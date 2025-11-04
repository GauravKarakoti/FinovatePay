import { useState, useEffect } from 'react';
import { api } from '../utils/api'; // Assuming you have a configured api utility
import { toast } from 'sonner';
import io from 'socket.io-client';
// --- IMPORT NEW WEB3 FUNCTIONS AND UTILS ---
import {
    getFractionTokenContract,
    getErc20Contract,
    stablecoinAddresses,
    connectWallet // Added for getting investor address
} from '../utils/web3';
import { ethers } from 'ethers';

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
        // Pass the full invoice object and the amount
        onInvest(invoice, investmentAmount);
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

    // --- UPDATED INVESTMENT LOGIC ---
    const handleInvest = async (invoice, amountToInvest) => {
        // This must be set in your .env.local file (e.g., VITE_PLATFORM_TREASURY_ADDRESS=0x...)
        const PLATFORM_TREASURY_WALLET = import.meta.env.VITE_PLATFORM_TREASURY_ADDRESS;
        // Using USDC, but you can add logic to select based on invoice.currency
        const PAYMENT_TOKEN_ADDRESS = stablecoinAddresses.USDC; 

        if (!PLATFORM_TREASURY_WALLET) {
            toast.error("Platform treasury address is not configured. Please contact support.");
            return;
        }

        let fractionToken;
        let paymentTokenContract;
        let tokenId;

        try {
            toast.loading('Preparing transaction... Please check your wallet.');
            
            // Get contract instances
            fractionToken = await getFractionTokenContract();
            paymentTokenContract = await getErc20Contract(PAYMENT_TOKEN_ADDRESS);
            tokenId = invoice.token_id;

            // 1. Parse amount based on the payment token's decimals
            // This is critical. If amountToInvest is "100" (for $100) and USDC has 6 decimals,
            // tokenAmount will be 100 * 10^6 = 100,000,000
            const paymentTokenDecimals = await paymentTokenContract.decimals();
            const tokenAmount = ethers.utils.parseUnits(amountToInvest, paymentTokenDecimals);
            
            // This is the amount of ERC1155 tokens to buy. 
            // We assume 1 token = $1, so "100" tokens.
            // **NOTE:** If your ERC1155 tokens also have decimals, you must adjust this.
            // For simplicity, we'll assume the ERC1155 amount is the same as the dollar amount.
            // If 1 token = $1, and USDC has 6 decimals, you pay 100,000,000 (USDC) for 100 (tokens).
            // The new contract function should handle this distinction.
            // Let's adjust based on the previous recommendation:
            // We'll assume the ERC1155 amount is `amountToInvest` (e.g., "100")
            // And the payment amount is the decimal-adjusted `tokenAmount`.
            // The `purchaseTokens` contract function needs to accept both.
            //
            // --- RE-READING ---
            // The previous `purchaseTokens` assumed `_amount` was for BOTH.
            // `uint256 paymentAmount = _amount;`
            // This means we must send the *decimal-adjusted* amount for both.
            // This implies 1 token = 1 unit of stablecoin (1 USDC, not $1).
            // e.g., to buy $100 (100,000,000 USDC units), you buy 100,000,000 tokens.
            // Let's stick to that for consistency.

            // 2. Check allowance
            const { address: investorAddress } = await connectWallet();
            const allowance = await paymentTokenContract.allowance(investorAddress, fractionToken.address);

            // 3. Approve ERC20 (USDC) spend if necessary
            if (allowance.lt(tokenAmount)) {
                toast.loading('Please approve USDC spending in your wallet...');
                const approveTx = await paymentTokenContract.approve(fractionToken.address, tokenAmount);
                await approveTx.wait();
                toast.success('Approval successful! Now confirming purchase...');
            } else {
                toast.loading('Approval found. Processing purchase...');
            }

            // 4. Call the purchaseTokens function
            // We send the decimal-adjusted amount for both payment and token quantity
            const tx = await fractionToken.purchaseTokens(
                tokenId,
                tokenAmount, // The amount of ERC1155 tokens (e.g., 100,000,000)
                PAYMENT_TOKEN_ADDRESS,
                PLATFORM_TREASURY_WALLET
            );

            await tx.wait();
            toast.success('Investment successful! Transaction confirmed.');

            // 5. Notify backend to *record* the investment
            // Use the human-readable amount ("100") for the database
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
            } else if (error.reason?.includes("ERC20 payment failed")) {
                toast.error("Payment failed. Do you have enough USDC?");
            } else if (error.reason?.includes("insufficient balance for transfer")) {
                toast.error("Platform treasury is empty. Cannot complete purchase.");
            } else {
                toast.error(error.reason || 'Investment failed. See console for details.');
            }
        }
    };
    // --- END UPDATED LOGIC ---


    const handleRedeem = async (holdingsToRedeem) => { // 'holdingsToRedeem' is an array: [{token_id, amount}, ...]
        toast.loading('Redeeming all tokens for this invoice...');
        
        // --- NOTE ---
        // This function also needs to be updated to use the frontend wallet,
        // similar to `handleInvest`. The backend `redeem-tokens` route
        // should be removed or changed to a `record-redemption` endpoint.
        // For now, the old logic is left as a placeholder.

        let totalRedeemedValue = 0;
        let failedRedemptions = 0;
        let successfulRedemptions = 0;

        try {
            // This loop calls the *old* backend API, which will fail
            // as the backend signer doesn't own the tokens.
            // This entire block needs to be rewritten.
            
            // --- START REWRITE (EXAMPLE) ---
            // 1. Get contract
            // const fractionToken = await getFractionTokenContract();
            
            // 2. Loop and call redeem from frontend
            // for (const holding of holdingsToRedeem) {
            //     if (holding.amount <= 0) continue; 
            //     try {
            //         // NOTE: `holding.amount` must be converted to the
            //         // correct decimal-adjusted BigNumber
            //         const tokenAmount = ethers.utils.parseUnits(holding.amount.toString(), 6); // Assuming 6 decimals
            //
            //         const tx = await fractionToken.redeem(holding.token_id, tokenAmount);
            //         const receipt = await tx.wait();
            //
            //         // Find the 'Redeemed' event in receipt.logs to get the value
            //         // (This part is complex and requires parsing logs)
            //         
            //         successfulRedemptions++;
            //
            //         // 5. Notify backend to record redemption
            //         await api.post('/investor/record-redemption', { ... });
            //
            //     } catch (error) {
            //          failedRedemptions++;
            //          toast.error(error.reason || `Failed to redeem token ${holding.token_id}`);
            //     }
            // }
            // --- END REWRITE (EXAMPLE) ---

            // Using old logic as a placeholder:
            toast.error("Redeem function not yet updated for frontend wallet. Please contact admin.");
            
            /*
            // OLD LOGIC (will fail)
            for (const holding of holdingsToRedeem) {
                if (holding.amount <= 0) continue;
                try {
                    const res = await api.post('/investor/redeem-tokens', {
                        tokenId: holding.token_id,
                        amount: holding.amount
                    });
                    totalRedeemedValue += parseFloat(res.data.redeemed_value) || 0;
                    successfulRedemptions++;
                } catch (error) {
                    failedRedemptions++;
                    console.error(`Failed to redeem token ${holding.token_id}`, error);
                    toast.error(error.response?.data?.msg || `Failed to redeem part of holding (Token ${holding.token_id.substring(0, 6)}...)`);
                }
            }
            */

            // Report final status
            if (successfulRedemptions > 0 && failedRedemptions === 0) {
                toast.success(`Successfully redeemed ${totalRedeemedValue.toFixed(2)} USD`);
            } else if (successfulRedemptions > 0 && failedRedemptions > 0) {
                toast.warning(`Partially redeemed ${totalRedeemedValue.toFixed(2)} USD. ${failedRedemptions} parts failed.`);
            } else if (successfulRedemptions === 0 && failedRedemptions > 0) {
                // toast.error('All redemption attempts failed.');
            } else {
                // toast.info('No tokens to redeem.');
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