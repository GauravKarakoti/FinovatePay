import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import api from '../../utils/api';
import { toast } from 'sonner';

const SUPPORTED_CHAINS = [
    { id: 'katana', name: 'Katana', icon: '⛓️' },
    { id: 'polygon-pos', name: 'Polygon PoS', icon: '📐' },
    { id: 'polygon-zkevm', name: 'Polygon zkEVM', icon: '🔒' }
];

const CrossChainFractionModal = ({ 
    isOpen, 
    onClose, 
    invoice, 
    tokenId, 
    fractions,
    onSuccess 
}) => {
    const [loading, setLoading] = useState(false);
    const [selectedChain, setSelectedChain] = useState('katana');
    const [amount, setAmount] = useState('');
    const [pricePerFraction, setPricePerFraction] = useState('');
    const [step, setStep] = useState('configure'); // configure, bridging, success

    useEffect(() => {
        if (isOpen && fractions) {
            // Set default price based on invoice face value
            if (invoice?.face_value && fractions > 0) {
                const defaultPrice = (invoice.face_value / fractions).toFixed(6);
                setPricePerFraction(defaultPrice);
            }
        }
    }, [isOpen, fractions, invoice]);

    const handleBridge = async () => {
        if (!amount || !pricePerFraction) {
            toast.error('Please fill in all fields');
            return;
        }

        if (parseFloat(amount) > parseFloat(fractions)) {
            toast.error('Amount exceeds available fractions');
            return;
        }

        setLoading(true);
        setStep('bridging');

        try {
            const response = await api.post('/crosschain/bridge', {
                tokenId: tokenId,
                invoiceId: invoice.invoice_id,
                amount: ethers.utils.parseUnits(amount, 18).toString(),
                destinationChain: selectedChain,
                pricePerFraction: ethers.utils.parseUnits(pricePerFraction, 6).toString()
            });

            if (response.data.success) {
                setStep('success');
                toast.success('Fractions bridged successfully!');
                if (onSuccess) {
                    onSuccess(response.data);
                }
            }
        } catch (error) {
            console.error('Bridge failed:', error);
            toast.error(error.response?.data?.error || 'Failed to bridge fractions');
            setStep('configure');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateListing = async () => {
        if (!amount || !pricePerFraction) {
            toast.error('Please fill in all fields');
            return;
        }

        if (parseFloat(amount) > parseFloat(fractions)) {
            toast.error('Amount exceeds available fractions');
            return;
        }

        setLoading(true);
        setStep('bridging');

        try {
            const response = await api.post('/crosschain/list', {
                tokenId: tokenId,
                invoiceId: invoice.invoice_id,
                amount: ethers.utils.parseUnits(amount, 18).toString(),
                destinationChain: selectedChain,
                pricePerFraction: ethers.utils.parseUnits(pricePerFraction, 6).toString()
            });

            if (response.data.success) {
                setStep('success');
                toast.success('Listing created on cross-chain marketplace!');
                if (onSuccess) {
                    onSuccess(response.data);
                }
            }
        } catch (error) {
            console.error('Listing failed:', error);
            toast.error(error.response?.data?.error || 'Failed to create listing');
            setStep('configure');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold">Cross-Chain Fractionalization</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        ✕
                    </button>
                </div>

                {step === 'configure' && (
                    <>
                        <p className="text-gray-600 mb-4 text-sm">
                            Bridge your invoice fractions to other chains for broader market access and liquidity.
                        </p>

                        {/* Invoice Info */}
                        <div className="bg-gray-50 rounded-lg p-3 mb-4">
                            <p className="text-sm text-gray-600">Invoice: <span className="font-mono">{invoice?.invoice_id?.substring(0, 8)}...</span></p>
                            <p className="text-sm text-gray-600">Available: <span className="font-semibold">{fractions} fractions</span></p>
                            {invoice?.face_value && (
                                <p className="text-sm text-gray-600">Face Value: <span className="font-semibold">{invoice.face_value} {invoice.currency}</span></p>
                            )}
                        </div>

                        {/* Chain Selector */}
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Destination Chain
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                                {SUPPORTED_CHAINS.map((chain) => (
                                    <button
                                        key={chain.id}
                                        onClick={() => setSelectedChain(chain.id)}
                                        className={`p-3 rounded-lg border-2 transition-all ${
                                            selectedChain === chain.id
                                                ? 'border-blue-500 bg-blue-50'
                                                : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                    >
                                        <div className="text-2xl mb-1">{chain.icon}</div>
                                        <div className="text-xs font-medium">{chain.name}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Amount Input */}
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Amount to Bridge
                            </label>
                            <input
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                max={fractions}
                                className="w-full p-2 border rounded-lg"
                                placeholder="Enter amount"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Available: {fractions} fractions
                            </p>
                        </div>

                        {/* Price Input */}
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Price per Fraction (USDC)
                            </label>
                            <input
                                type="number"
                                step="0.000001"
                                value={pricePerFraction}
                                onChange={(e) => setPricePerFraction(e.target.value)}
                                className="w-full p-2 border rounded-lg"
                                placeholder="0.00"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Total value: {amount && pricePerFraction 
                                    ? (parseFloat(amount) * parseFloat(pricePerFraction)).toFixed(2) 
                                    : '0.00'} USDC
                            </p>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                            <button
                                onClick={onClose}
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleBridge}
                                disabled={loading || !amount || !pricePerFraction}
                                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                            >
                                {loading ? 'Processing...' : 'Bridge'}
                            </button>
                        </div>
                    </>
                )}

                {step === 'bridging' && (
                    <div className="text-center py-8">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                        <p className="text-gray-600">Bridging fractions to {SUPPORTED_CHAINS.find(c => c.id === selectedChain)?.name}...</p>
                        <p className="text-sm text-gray-500 mt-2">This may take a few minutes.</p>
                    </div>
                )}

                {step === 'success' && (
                    <div className="text-center py-8">
                        <div className="text-5xl mb-4">✅</div>
                        <p className="text-lg font-semibold text-gray-900 mb-2">Success!</p>
                        <p className="text-gray-600 mb-4">
                            Your fractions have been bridged to {SUPPORTED_CHAINS.find(c => c.id === selectedChain)?.name}.
                        </p>
                        <button
                            onClick={onClose}
                            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                        >
                            Done
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CrossChainFractionModal;
