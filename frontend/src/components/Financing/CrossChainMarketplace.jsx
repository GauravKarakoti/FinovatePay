import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { toast } from 'sonner';

const CHAIN_INFO = {
    'katana': { name: 'Katana', icon: '⛓️', color: 'bg-purple-100' },
    'polygon-pos': { name: 'Polygon PoS', icon: '📐', color: 'bg-blue-100' },
    'polygon-zkevm': { name: 'Polygon zkEVM', icon: '🔒', color: 'bg-green-100' }
};

const CrossChainMarketplace = ({ userRole }) => {
    const [listings, setListings] = useState({});
    const [selectedChain, setSelectedChain] = useState('all');
    const [loading, setLoading] = useState(true);
    const [buyingAmount, setBuyingAmount] = useState({});
    const [purchasing, setPurchasing] = useState({});

    useEffect(() => {
        fetchListings();
    }, []);

    const fetchListings = async () => {
        try {
            setLoading(true);
            const response = await api.get('/crosschain/marketplace');
            if (response.data.success) {
                setListings(response.data.listings);
            }
        } catch (error) {
            console.error('Failed to fetch listings:', error);
            toast.error('Failed to load marketplace listings');
        } finally {
            setLoading(false);
        }
    };

    const handlePurchase = async (listing) => {
        const amount = buyingAmount[listing.id];
        if (!amount || parseFloat(amount) <= 0) {
            toast.error('Please enter a valid amount');
            return;
        }

        if (parseFloat(amount) > parseFloat(listing.remaining_amount)) {
            toast.error('Amount exceeds available supply');
            return;
        }

        setPurchasing(prev => ({ ...prev, [listing.id]: true }));

        try {
            const response = await api.post('/crosschain/trade', {
                listingId: listing.id,
                amount: amount
            });

            if (response.data.success) {
                toast.success('Purchase successful!');
                fetchListings();
            }
        } catch (error) {
            console.error('Purchase failed:', error);
            toast.error(error.response?.data?.error || 'Purchase failed');
        } finally {
            setPurchasing(prev => ({ ...prev, [listing.id]: false }));
        }
    };

    const formatAmount = (amount) => {
        if (!amount) return '0';
        return parseFloat(amount).toLocaleString(undefined, { maximumFractionDigits: 2 });
    };

    const getAllListings = () => {
        if (selectedChain === 'all') {
            return Object.entries(listings).flatMap(([chain, chainListings]) =>
                (chainListings || []).map(listing => ({ ...listing, chain }))
            );
        }
        return listings[selectedChain] || [];
    };

    const filteredListings = getAllListings();

    return (
        <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-xl font-bold">Cross-Chain Marketplace</h3>
                    <p className="text-sm text-gray-600">Buy invoice fractions from other chains</p>
                </div>
                <button
                    onClick={fetchListings}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                    Refresh
                </button>
            </div>

            {/* Chain Filter */}
            <div className="flex gap-2 mb-6 overflow-x-auto">
                <button
                    onClick={() => setSelectedChain('all')}
                    className={`px-4 py-2 rounded-lg whitespace-nowrap ${
                        selectedChain === 'all' 
                            ? 'bg-blue-500 text-white' 
                            : 'bg-gray-100 hover:bg-gray-200'
                    }`}
                >
                    All Chains
                </button>
                {Object.entries(CHAIN_INFO).map(([chainId, info]) => (
                    <button
                        key={chainId}
                        onClick={() => setSelectedChain(chainId)}
                        className={`px-4 py-2 rounded-lg whitespace-nowrap flex items-center gap-2 ${
                            selectedChain === chainId 
                                ? 'bg-blue-500 text-white' 
                                : 'bg-gray-100 hover:bg-gray-200'
                        }`}
                    >
                        <span>{info.icon}</span>
                        <span>{info.name}</span>
                    </button>
                ))}
            </div>

            {/* Listings */}
            {loading ? (
                <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                    <p className="text-gray-500 mt-2">Loading listings...</p>
                </div>
            ) : filteredListings.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                    <p>No listings available on {selectedChain === 'all' ? 'any chain' : CHAIN_INFO[selectedChain]?.name}</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {filteredListings.map((listing) => (
                        <div key={listing.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${CHAIN_INFO[listing.destination_chain]?.color || 'bg-gray-100'}`}>
                                            {CHAIN_INFO[listing.destination_chain]?.icon} {CHAIN_INFO[listing.destination_chain]?.name}
                                        </span>
                                        <span className="text-xs text-gray-500">
                                            Listed {new Date(listing.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <p className="font-mono text-sm text-gray-600">
                                        Invoice: {listing.invoice_id?.substring(0, 8)}...
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-lg font-bold text-blue-600">
                                        {listing.price_per_fraction} USDC
                                    </p>
                                    <p className="text-xs text-gray-500">per fraction</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                                <div>
                                    <p className="text-gray-500">Total Listed</p>
                                    <p className="font-semibold">{formatAmount(listing.amount)}</p>
                                </div>
                                <div>
                                    <p className="text-gray-500">Remaining</p>
                                    <p className="font-semibold">{formatAmount(listing.remaining_amount)}</p>
                                </div>
                                <div>
                                    <p className="text-gray-500">Total Sold</p>
                                    <p className="font-semibold">{formatAmount(listing.total_sold)}</p>
                                </div>
                            </div>

                            {/* Purchase Form */}
                            {userRole === 'buyer' || userRole === 'investor' ? (
                                <div className="flex gap-2 items-end">
                                    <div className="flex-1">
                                        <label className="block text-xs text-gray-500 mb-1">Amount to Buy</label>
                                        <input
                                            type="number"
                                            value={buyingAmount[listing.id] || ''}
                                            onChange={(e) => setBuyingAmount(prev => ({ ...prev, [listing.id]: e.target.value }))}
                                            max={listing.remaining_amount}
                                            className="w-full p-2 border rounded-lg text-sm"
                                            placeholder="Enter amount"
                                        />
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-gray-500">Total</p>
                                        <p className="font-semibold">
                                            {buyingAmount[listing.id] 
                                                ? (parseFloat(buyingAmount[listing.id]) * parseFloat(listing.price_per_fraction)).toFixed(2)
                                                : '0.00'
                                            } USDC
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => handlePurchase(listing)}
                                        disabled={purchasing[listing.id] || !buyingAmount[listing.id]}
                                        className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 text-sm"
                                    >
                                        {purchasing[listing.id] ? 'Buying...' : 'Buy'}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CrossChainMarketplace;
