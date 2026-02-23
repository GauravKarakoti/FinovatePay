import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { connectWallet, getFinancingManagerContract, stablecoinAddresses } from '../../utils/web3';
import api from '../../utils/api';
import { toast } from 'sonner';

const BridgeFinancingModal = ({ isOpen, onClose, invoiceId, invoiceAmount }) => {
    const [loading, setLoading] = useState(false);
    const [rates, setRates] = useState(null);
    const [selectedAsset, setSelectedAsset] = useState('USDC');
    const [borrowAmount, setBorrowAmount] = useState('');
    const [collateralTokenId, setCollateralTokenId] = useState('');

    useEffect(() => {
        if (isOpen) {
            fetchRates();
        }
    }, [isOpen, selectedAsset]);

    const fetchRates = async () => {
        try {
            const response = await api.get(`/financing/rates/${selectedAsset}`);
            setRates(response.data);
        } catch (error) {
            console.error('Failed to fetch rates:', error);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            // Connect wallet
            const { signer, address } = await connectWallet();

            // Request financing via backend
            const response = await api.post('/financing/request', {
                invoiceId,
                amount: ethers.utils.parseUnits(borrowAmount, 6), // Assuming 6 decimals for stablecoins
                asset: selectedAsset,
                collateralTokenId: parseInt(collateralTokenId)
            });

            toast.success('Financing request submitted successfully!');
            onClose();
        } catch (error) {
            console.error('Financing request failed:', error);
            toast.error('Financing request failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
                <h2 className="text-xl font-bold mb-4">Bridge Financing via Katana</h2>

                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-2">Asset to Borrow</label>
                        <select
                            value={selectedAsset}
                            onChange={(e) => setSelectedAsset(e.target.value)}
                            className="w-full p-2 border rounded"
                        >
                            <option value="USDC">USDC</option>
                            <option value="EURC">EURC</option>
                            <option value="BRLC">BRLC</option>
                        </select>
                    </div>

                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-2">Borrow Amount</label>
                        <input
                            type="number"
                            value={borrowAmount}
                            onChange={(e) => setBorrowAmount(e.target.value)}
                            className="w-full p-2 border rounded"
                            placeholder="Enter amount"
                            required
                        />
                    </div>

                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-2">Collateral Token ID</label>
                        <input
                            type="number"
                            value={collateralTokenId}
                            onChange={(e) => setCollateralTokenId(e.target.value)}
                            className="w-full p-2 border rounded"
                            placeholder="FractionToken ID"
                            required
                        />
                    </div>

                    {rates && (
                        <div className="mb-4 p-3 bg-gray-100 rounded">
                            <p className="text-sm">Borrow Rate: {(rates.borrowRate * 100).toFixed(2)}% APY</p>
                            <p className="text-sm">Available Liquidity: {ethers.utils.formatUnits(rates.availableLiquidity, 6)}</p>
                        </div>
                    )}

                    <div className="flex justify-end space-x-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                        >
                            {loading ? 'Processing...' : 'Request Financing'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default BridgeFinancingModal;
