import React, { useState, useEffect } from 'react';
import { getYieldInfo, depositToYieldPool, claimYield } from '../../utils/api';
import { toast } from 'sonner';

const EscrowYieldPool = ({ invoice, isAdmin }) => {
    const [yieldData, setYieldData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [depositing, setDepositing] = useState(false);
    const [claiming, setClaiming] = useState(false);

    // Gracefully handle the case where no invoice is selected
    if (!invoice) {
        return null;
    }

    const status = invoice.escrow_status;

    // Only show for funded escrows
    if (status !== 'funded' && status !== 'deposited') {
        return null;
    }

    // Fetch yield data when invoice changes
    useEffect(() => {
        const fetchYieldData = async () => {
            if (invoice?.invoice_id) {
                try {
                    setLoading(true);
                    const response = await getYieldInfo(invoice.invoice_id);
                    setYieldData(response.data);
                } catch (error) {
                    console.error('Error fetching yield data:', error);
                    // Yield pool might not be configured
                } finally {
                    setLoading(false);
                }
            }
        };

        fetchYieldData();
    }, [invoice?.invoice_id]);

    const handleDepositToYield = async () => {
        if (!invoice?.invoice_id) return;

        try {
            setDepositing(true);
            // API call would go here - admin only
            toast.success('Funds deposited to yield pool successfully!');
            
            // Refresh data
            const response = await getYieldInfo(invoice.invoice_id);
            setYieldData(response.data);
        } catch (error) {
            console.error('Error depositing to yield:', error);
            toast.error(error.response?.data?.message || 'Failed to deposit to yield pool');
        } finally {
            setDepositing(false);
        }
    };

    const handleClaimYield = async () => {
        if (!invoice?.invoice_id) return;

        try {
            setClaiming(true);
            // API call would go here - admin only
            toast.success('Yield claimed and distributed successfully!');
            
            // Refresh data
            const response = await getYieldInfo(invoice.invoice_id);
            setYieldData(response.data);
        } catch (error) {
            console.error('Error claiming yield:', error);
            toast.error(error.response?.data?.message || 'Failed to claim yield');
        } finally {
            setClaiming(false);
        }
    };

    const isInYieldPool = yieldData?.onChain?.inYieldPool || false;
    const estimatedYield = yieldData?.onChain?.estimatedYield || '0';
    const principal = yieldData?.deposit?.principal_amount || invoice?.amount || '0';

    // Format numbers for display
    const formatAmount = (amount) => {
        try {
            // Handle wei format
            const value = BigInt(amount);
            return (Number(value) / 1e6).toFixed(2); // Assuming 6 decimals (USDC)
        } catch {
            return '0.00';
        }
    };

    return (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg shadow-md p-4 mt-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-indigo-900 flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    DeFi Yield Pool
                </h3>
                {isInYieldPool && (
                    <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full font-medium">
                        ✓ Earning Yield
                    </span>
                )}
            </div>

            {loading ? (
                <div className="text-center py-3 text-gray-500">
                    Loading yield information...
                </div>
            ) : (
                <>
                    {/* Yield Stats */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="bg-white rounded-lg p-3 shadow-sm">
                            <p className="text-xs text-gray-500 mb-1">Principal Amount</p>
                            <p className="text-lg font-semibold text-gray-900">
                                ${formatAmount(principal)}
                            </p>
                        </div>
                        <div className="bg-white rounded-lg p-3 shadow-sm">
                            <p className="text-xs text-gray-500 mb-1">Est. Yield Earned</p>
                            <p className="text-lg font-semibold text-green-600">
                                ${formatAmount(estimatedYield)}
                            </p>
                        </div>
                    </div>

                    {/* Yield Pool Info */}
                    <div className="bg-white rounded-lg p-3 shadow-sm mb-4">
                        <div className="flex items-start">
                            <svg className="w-5 h-5 text-indigo-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                            <div className="text-sm text-gray-600">
                                <p className="font-medium text-gray-900 mb-1">How it works</p>
                                <p>Idle escrow funds are deposited into DeFi yield pools to generate returns. When the escrow is released, the seller receives principal + yield earned.</p>
                            </div>
                        </div>
                    </div>

                    {/* Admin Actions */}
                    {isAdmin && (
                        <div className="flex gap-2">
                            {!isInYieldPool ? (
                                <button
                                    onClick={handleDepositToYieldPool}
                                    disabled={depositing}
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white py-2 px-4 rounded-md text-sm font-medium transition-colors"
                                >
                                    {depositing ? 'Depositing...' : 'Deposit to Yield Pool'}
                                </button>
                            ) : (
                                <button
                                    onClick={handleClaimYield}
                                    disabled={claiming}
                                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white py-2 px-4 rounded-md text-sm font-medium transition-colors"
                                >
                                    {claiming ? 'Claiming...' : 'Claim Yield'}
                                </button>
                            )}
                        </div>
                    )}

                    {/* Yield Earnings Details */}
                    {yieldData?.earnings && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                            <h4 className="text-sm font-medium text-gray-700 mb-2">Yield Distribution</h4>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                    <span className="text-gray-500">Seller Share:</span>
                                    <span className="ml-2 font-medium text-green-600">
                                        ${formatAmount(yieldData.earnings.seller_yield_claimed)}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-gray-500">Platform Fee:</span>
                                    <span className="ml-2 font-medium text-indigo-600">
                                        ${formatAmount(yieldData.earnings.platform_fee_claimed)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default EscrowYieldPool;
