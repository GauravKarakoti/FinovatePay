import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { toast } from 'sonner';
import io from 'socket.io-client';
import { ethers } from 'ethers';

import FiatOnRampModal from '../components/Dashboard/FiatOnRampModal';
import { getFractionTokenContract, stablecoinAddresses } from '../utils/web3';
import { BuyFractionToken } from '../components/Financing/BuyFractionToken';

// --- UPDATED INVOICE CARD ---
const InvoiceCard = ({ invoice, onPurchaseSuccess }) => {
    const { 
        invoice_id, 
        amount, 
        due_date, 
        currency, 
        remaining_supply, 
        token_id 
    } = invoice;

    const face_value_display = amount; 
    const maturity = new Date(due_date).toLocaleDateString();

    // Determine stablecoin details.
    // If currency is Native (MATIC), we still pass USDC details as the 'Stablecoin' option 
    // because the BuyFractionToken component now offers a toggle between Native and Stablecoin.
    const isNative = currency === 'MATIC' || currency === 'ETH';
    
    // Use specific stablecoin if matches currency, otherwise default to USDC
    const stablecoinAddress = stablecoinAddresses[currency] || stablecoinAddresses["USDC"];
    
    // USDC uses 6 decimals, most others (and fallback logic) might default to 18 or 6. 
    // We force 6 for USDC to prevent approval errors.
    const isUSDC = stablecoinAddress === stablecoinAddresses["USDC"];
    const stablecoinDecimals = isUSDC ? 6 : 18; 

    return (
        <div className="bg-white shadow rounded-lg p-4 border border-gray-200">
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold text-finovate-blue-800">
                    Invoice {invoice_id.substring(0, 8)}...
                </h3>
            </div>
            <p className="text-sm text-gray-600">Matures on: {maturity}</p>
            
            <div className="mt-4 space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                    <span>Face Value:</span>
                    <span className="font-medium">{currency} {face_value_display}</span>
                </div>
                <div className="flex justify-between text-sm">
                    <span>Remaining to Invest:</span>
                    <span className="font-medium text-green-600">
                        {currency} {Number(remaining_supply).toFixed(2)}
                    </span>
                </div>
            </div>

            {/* --- V3 INTEGRATION: BuyFractionToken Component --- */}
            {/* Removed the isNative check. The component now handles the toggle internally. */}
            <BuyFractionToken
                tokenId={token_id}
                stablecoinAddress={stablecoinAddress}
                stablecoinDecimals={stablecoinDecimals}
                tokenDecimals={18} // FractionToken standard
                maxAmount={remaining_supply} // Pass simple number or string
                onSuccess={onPurchaseSuccess} // Callback to refresh list
            />
        </div>
    );
};

const PortfolioItem = ({ item, onRedeem }) => {
    const { invoice, total_tokens, holdings } = item;
    const { invoice_id, due_date, status, currency } = invoice;

    const maturity = new Date(due_date).toLocaleDateString();
    // Check if today is past due date
    const isMatured = new Date() >= new Date(due_date);

    return (
        <div className="bg-white shadow rounded-lg p-4 flex justify-between items-center">
            <div>
                <h3 className="text-lg font-semibold">Invoice {invoice_id.substring(0, 8)}...</h3>
                <p className="text-sm text-gray-600">
                    Tokens Owned: <span className="font-medium">{Number(total_tokens).toFixed(2)}</span>
                </p>
                <p className="text-sm text-gray-600">Maturity: {maturity}</p>
            </div>
            <button
                onClick={() => onRedeem(holdings, invoice)}
                disabled={!isMatured || status === 'redeemed'}
                className={`px-4 py-2 rounded-md text-white text-sm ${
                    status === 'redeemed' 
                        ? 'bg-gray-400 cursor-not-allowed' 
                        : isMatured 
                        ? 'bg-green-600 hover:bg-green-700' 
                        : 'bg-gray-400 cursor-not-allowed'
                }`}
            >
                {status === 'redeemed' ? 'Redeemed' : (isMatured ? 'Redeem' : 'Not Matured')}
            </button>
        </div>
    );
};

const InvestorDashboard = ({ activeTab }) => {
    const [marketplaceListings, setMarketplaceListings] = useState([]);
    const [portfolio, setPortfolio] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showFiatModal, setShowFiatModal] = useState(false);

    // Setup Socket.IO
    useEffect(() => {
        const socket = io(import.meta.env.VITE_API_URL);
        socket.emit('join-marketplace');

        socket.on('new-listing', (newInvoice) => {
            toast.info(`New invoice listed for financing: ${newInvoice.invoice_id}`);
            setMarketplaceListings(prev => [newInvoice, ...prev]);
        });

        socket.on('investment-made', ({ invoiceId, newSupply }) => {
            setMarketplaceListings(prev =>
                prev.map(inv =>
                    inv.invoice_id === invoiceId ? { ...inv, remaining_supply: newSupply } : inv
                )
            );
        });

        return () => socket.disconnect();
    }, []);

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
            const holdings = new Map();
            
            res.data.forEach(item => {
                const { invoice, tokens_owned, token_id } = item;
                if (!invoice || !invoice.invoice_id) return;
                
                const invoiceId = invoice.invoice_id;
                const tokenAmount = parseFloat(tokens_owned); 

                if (Number.isNaN(tokenAmount) || tokenAmount <= 0) return;

                if (holdings.has(invoiceId)) {
                    const existing = holdings.get(invoiceId);
                    existing.total_tokens += tokenAmount;
                    existing.holdings.push({ token_id: token_id, amount: tokens_owned }); 
                } else {
                    holdings.set(invoiceId, {
                        invoice: invoice,
                        total_tokens: tokenAmount,
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

    const handlePurchaseSuccess = () => {
        // Refresh data after a successful purchase via BuyFractionToken
        fetchMarketplace();
        fetchPortfolio();
    };

    // Redemption logic stays largely the same (Direct interaction with FractionToken)
    const handleRedeem = async (holdingsToRedeem, invoice) => { 
        toast.loading('Redeeming tokens... Please check your wallet.');
        
        let totalRedeemedValue = ethers.BigNumber.from(0);
        let successfulRedemptions = 0;
        let failedRedemptions = 0;
        const txHashes = [];

        try {
            const fractionToken = await getFractionTokenContract();
            
            for (const holding of holdingsToRedeem) {
                if (!holding.amount || parseFloat(holding.amount) <= 0) continue; 
                
                try {
                    // Ethers v5 Syntax
                    const tokenAmountToRedeem = ethers.utils.parseEther(holding.amount.toString());
                    
                    if (tokenAmountToRedeem.isZero()) continue;

                    const tx = await fractionToken.redeem(holding.token_id, tokenAmountToRedeem);
                    const receipt = await tx.wait();
                    txHashes.push(receipt.transactionHash);

                    // Check for Redeemed event
                    const redeemEvent = receipt.events?.find(e => e.event === 'Redeemed');
                    if (redeemEvent) {
                        totalRedeemedValue = totalRedeemedValue.add(redeemEvent.args.amount || redeemEvent.args[2]); // Adjust based on exact ABI args
                    }
                    successfulRedemptions++;

                } catch (error) {
                     failedRedemptions++;
                     console.error(error);
                     toast.error(error.reason || `Failed to redeem token ${holding.token_id}`);
                }
            }

            const totalRedeemedReadable = ethers.utils.formatEther(totalRedeemedValue);

            if (successfulRedemptions > 0) {
                toast.dismiss();
                toast.success(`Successfully redeemed ${totalRedeemedReadable} ${invoice.currency}.`);
                
                // Record redemption in backend
                try {
                    await api.post('/investor/record-redemption', {
                        invoiceId: invoice.invoice_id,
                        redeemedAmount: totalRedeemedReadable,
                        txHashes: txHashes
                    });
                } catch (apiError) {
                    console.error("Backend sync failed", apiError);
                }
            }

            if (failedRedemptions > 0) {
                toast.warning(`${failedRedemptions} redemption attempts failed.`);
            }
            
            fetchPortfolio(); 

        } catch (error) {
            console.error(error);
            toast.dismiss();
            if (error.code === 4001) {
                toast.error('Transaction rejected in wallet.');
            } else {
                toast.error('An unexpected error occurred.');
            }
        }
    };

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
                                onPurchaseSuccess={handlePurchaseSuccess}
                            />
                        ))
                    ) : (
                        !isLoading && <p>No invoices currently listed for financing.</p>
                    )}
                </div>
            </div>

            {/* Column 2: Portfolio */}
            <div>
                <h2 className="text-2xl font-semibold mb-4">My Portfolio</h2>
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
                        <p>You have not invested in any invoices yet.</p>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                {activeTab === 'financing' && (
                    <button 
                        onClick={() => setShowFiatModal(true)}
                        className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg font-medium flex items-center shadow-md transition-all hover:scale-105"
                    >
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        Buy Stablecoins
                    </button>
                )}
            </div>

            {activeTab === 'overview' && (
                <div>
                    <h1 className="text-3xl font-semibold mb-6">Investor Overview</h1>
                    <p>Welcome to your investor dashboard. Select 'Financing' to view the marketplace.</p>
                </div>
            )}

            {activeTab === 'financing' && renderFinancingContent()}

            {showFiatModal && (
                <FiatOnRampModal 
                    onClose={() => setShowFiatModal(false)}
                    onSuccess={(amount) => {
                        // Optional: Refresh balance or log
                        console.log(`User purchased ${amount}`);
                    }}
                />
            )}
        </div>
    );
};

export default InvestorDashboard;