import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import api from '../../utils/api';
import { toast } from 'sonner';

const EscrowInsuranceToggle = ({ 
    invoiceId, 
    invoiceAmount, 
    isOpen, 
    onClose,
    existingPolicy 
}) => {
    const [loading, setLoading] = useState(false);
    const [calculatingPremium, setCalculatingPremium] = useState(false);
    const [config, setConfig] = useState(null);
    const [premium, setPremium] = useState(null);
    const [coverageAmount, setCoverageAmount] = useState('');
    const [durationDays, setDurationDays] = useState(30);
    const [enableInsurance, setEnableInsurance] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchConfig();
            if (existingPolicy) {
                setEnableInsurance(true);
                setCoverageAmount(existingPolicy.coverage_amount);
                setDurationDays(Math.ceil((new Date(existingPolicy.end_time) - new Date()) / (1000 * 60 * 60 * 24)));
            }
        }
    }, [isOpen, existingPolicy]);

    useEffect(() => {
        if (coverageAmount && durationDays && isOpen) {
            calculatePremium();
        }
    }, [coverageAmount, durationDays]);

    const fetchConfig = async () => {
        try {
            const response = await api.get('/insurance/config');
            setConfig(response.data.config);
        } catch (error) {
            console.error('Failed to fetch insurance config:', error);
        }
    };

    const calculatePremium = async () => {
        if (!coverageAmount || !durationDays) return;
        
        setCalculatingPremium(true);
        try {
            const durationSeconds = durationDays * 24 * 60 * 60;
            const response = await api.get('/insurance/calculate-premium', {
                params: {
                    coverageAmount: ethers.utils.parseUnits(coverageAmount, 6).toString(),
                    durationSeconds
                }
            });
            setPremium(response.data.premium);
        } catch (error) {
            console.error('Failed to calculate premium:', error);
        } finally {
            setCalculatingPremium(false);
        }
    };

    const handlePurchase = async (e) => {
        e.preventDefault();
        
        if (!coverageAmount) {
            toast.error('Please enter coverage amount');
            return;
        }

        setLoading(true);
        try {
            const durationSeconds = durationDays * 24 * 60 * 60;
            const response = await api.post('/insurance/purchase', {
                invoiceId,
                coverageAmount: ethers.utils.parseUnits(coverageAmount, 6).toString(),
                durationSeconds,
                paymentToken: '0x0000000000000000000000000000000000000000' // ETH
            });

            toast.success('Insurance purchased successfully!');
            onClose(true); // Close with success
        } catch (error) {
            console.error('Failed to purchase insurance:', error);
            toast.error(error.response?.data?.message || 'Failed to purchase insurance');
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount) => {
        try {
            return ethers.utils.formatUnits(amount, 6);
        } catch {
            return amount;
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">
                        {existingPolicy ? 'Insurance Details' : 'Add Insurance to Escrow'}
                    </h2>
                    <button onClick={() => onClose(false)} className="text-gray-500 hover:text-gray-700">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {existingPolicy ? (
                    // View existing policy
                    <div className="space-y-4">
                        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                            <div className="flex items-center mb-2">
                                <svg className="w-5 h-5 text-green-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                <span className="font-semibold text-green-800">Active Insurance</span>
                            </div>
                            <p className="text-sm text-green-700">
                                Your escrow is protected against counterparty default and smart contract failure.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm text-gray-500">Policy ID</p>
                                <p className="font-mono text-xs">{existingPolicy.policy_id?.slice(0, 10)}...</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Status</p>
                                <span className="inline-flex items-center px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                                    {existingPolicy.status}
                                </span>
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Coverage Amount</p>
                                <p className="font-semibold">${formatCurrency(existingPolicy.coverage_amount)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Premium Paid</p>
                                <p className="font-semibold">${formatCurrency(existingPolicy.premium_paid)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Start Date</p>
                                <p className="text-sm">{new Date(existingPolicy.start_time).toLocaleDateString()}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">End Date</p>
                                <p className="text-sm">{new Date(existingPolicy.end_time).toLocaleDateString()}</p>
                            </div>
                        </div>

                        <button
                            onClick={() => onClose(false)}
                            className="w-full py-2 px-4 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                        >
                            Close
                        </button>
                    </div>
                ) : (
                    // Purchase new insurance
                    <form onSubmit={handlePurchase}>
                        {!enableInsurance ? (
                            <div className="space-y-4">
                                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-semibold text-blue-800">Optional Insurance</h3>
                                            <p className="text-sm text-blue-600 mt-1">
                                                Protect your escrow against counterparty default or smart contract failure.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setEnableInsurance(true)}
                                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                                        >
                                            Add Insurance
                                        </button>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onClose(false)}
                                    className="w-full py-2 px-4 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                                >
                                    Skip
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="mb-4">
                                    <label className="block text-sm font-medium mb-2">
                                        Coverage Amount (USD)
                                    </label>
                                    <input
                                        type="number"
                                        value={coverageAmount}
                                        onChange={(e) => setCoverageAmount(e.target.value)}
                                        className="w-full p-2 border rounded"
                                        placeholder="Enter coverage amount"
                                        max={invoiceAmount}
                                        required
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        Max: ${invoiceAmount}
                                        {config && (
                                            <> | Min: ${formatCurrency(config.minCoverageAmount)}</>
                                        )}
                                    </p>
                                </div>

                                <div className="mb-4">
                                    <label className="block text-sm font-medium mb-2">
                                        Coverage Duration (Days)
                                    </label>
                                    <input
                                        type="number"
                                        value={durationDays}
                                        onChange={(e) => setDurationDays(parseInt(e.target.value) || 0)}
                                        className="w-full p-2 border rounded"
                                        min="1"
                                        max="730"
                                        required
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        Min: 1 day, Max: 730 days (2 years)
                                    </p>
                                </div>

                                {calculatingPremium ? (
                                    <div className="p-4 bg-gray-50 rounded-lg">
                                        <p className="text-center text-gray-500">Calculating premium...</p>
                                    </div>
                                ) : premium && (
                                    <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <p className="text-sm text-green-600">Estimated Premium</p>
                                                <p className="text-2xl font-bold text-green-800">
                                                    ${formatCurrency(premium)}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs text-green-600">Coverage Ratio</p>
                                                <p className="text-sm font-semibold text-green-800">
                                                    {((parseFloat(coverageAmount) || 0) / parseFloat(formatCurrency(premium)) || 0).toFixed(1)}x
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {config && (
                                    <div className="p-3 bg-gray-50 rounded text-xs text-gray-600">
                                        <p className="font-semibold mb-1">Insurance Coverage Includes:</p>
                                        <ul className="list-disc list-inside space-y-1">
                                            <li>Counterparty default protection</li>
                                            <li>Smart contract failure protection</li>
                                            <li>Up to ${formatCurrency(config.maxCoverageAmount)} coverage</li>
                                        </ul>
                                    </div>
                                )}

                                <div className="flex space-x-2">
                                    <button
                                        type="button"
                                        onClick={() => setEnableInsurance(false)}
                                        className="flex-1 py-2 px-4 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={loading || calculatingPremium || !premium}
                                        className="flex-1 py-2 px-4 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                                    >
                                        {loading ? 'Processing...' : 'Purchase Insurance'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </form>
                )}
            </div>
        </div>
    );
};

export default EscrowInsuranceToggle;
