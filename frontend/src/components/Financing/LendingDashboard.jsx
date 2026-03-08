import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-hot-toast';

const LendingDashboard = ({ userRole }) => {
    const [loans, setLoans] = useState([]);
    const [eligibility, setEligibility] = useState(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState('overview'); // overview, borrow, repay, collateral, liquidations
    
    // Form states
    const [borrowAmount, setBorrowAmount] = useState('');
    const [repayAmount, setRepayAmount] = useState('');
    const [collateralAmount, setCollateralAmount] = useState('');
    const [collateralValue, setCollateralValue] = useState('');
    const [ltvPreview, setLtvPreview] = useState(null);

    useEffect(() => {
        fetchLendingData();
    }, []);

    const fetchLendingData = async () => {
        try {
            setLoading(true);
            
            // Fetch eligibility
            const eligibilityRes = await fetch('/api/v1/lending/eligibility', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const eligibilityData = await eligibilityRes.json();
            setEligibility(eligibilityData);

            // Fetch user's loans
            const loansRes = await fetch('/api/v1/lending/loans', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const loansData = await loansRes.json();
            setLoans(loansData.loans || []);
        } catch (error) {
            console.error('Failed to fetch lending data:', error);
            toast.error('Failed to load lending data');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateLoan = async (e) => {
        e.preventDefault();
        if (!borrowAmount || parseFloat(borrowAmount) <= 0) {
            toast.error('Please enter a valid amount');
            return;
        }
        if (!collateralValue || parseFloat(collateralValue) <= 0) {
            toast.error('Please enter collateral value');
            return;
        }

        try {
            setSubmitting(true);
            const amountWei = ethers.parseUnits(borrowAmount, 6).toString();
            const collateralWei = ethers.parseUnits(collateralValue, 6).toString();
            
            const res = await fetch('/api/v1/lending/loans', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    principal: amountWei,
                    collateralValue: collateralWei,
                    loanDuration: 180 * 24 * 60 * 60 // 180 days
                })
            });

            const data = await res.json();
            if (data.success) {
                toast.success(`Loan created successfully! LTV: ${data.ltv / 100}%`);
                setBorrowAmount('');
                setCollateralValue('');
                setCollateralAmount('');
                fetchLendingData();
            } else {
                toast.error(data.error || 'Loan creation failed');
            }
        } catch (error) {
            console.error('Create loan error:', error);
            toast.error('Loan creation failed');
        } finally {
            setSubmitting(false);
        }
    };

    const handleBorrow = async (loanId, e) => {
        e.preventDefault();
        if (!borrowAmount || parseFloat(borrowAmount) <= 0) {
            toast.error('Please enter a valid amount');
            return;
        }

        try {
            setSubmitting(true);
            const amountWei = ethers.parseEther(borrowAmount).toString();
            
            const res = await fetch(`/api/v1/lending/loans/${loanId}/borrow`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ amount: amountWei })
            });

            const data = await res.json();
            if (data.success) {
                toast.success(`Successfully borrowed ${borrowAmount}! New LTV: ${data.newLTV / 100}%`);
                setBorrowAmount('');
                fetchLendingData();
            } else {
                toast.error(data.error || 'Borrow failed');
            }
        } catch (error) {
            console.error('Borrow error:', error);
            toast.error('Borrow failed');
        } finally {
            setSubmitting(false);
        }
    };

    const handleRepay = async (loanId, e) => {
        e.preventDefault();
        if (!repayAmount || parseFloat(repayAmount) <= 0) {
            toast.error('Please enter a valid amount');
            return;
        }

        try {
            setSubmitting(true);
            const amountWei = ethers.parseEther(repayAmount).toString();
            
            const res = await fetch(`/api/v1/lending/loans/${loanId}/repay`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ amount: amountWei })
            });

            const data = await res.json();
            if (data.success) {
                toast.success(`Repaid ${repayAmount}!`);
                if (data.interestPaid && parseFloat(data.interestPaid) > 0) {
                    toast.success(`Interest paid: ${ethers.formatEther(data.interestPaid)}`);
                }
                setRepayAmount('');
                fetchLendingData();
            } else {
                toast.error(data.error || 'Repayment failed');
            }
        } catch (error) {
            console.error('Repay error:', error);
            toast.error('Repayment failed');
        } finally {
            setSubmitting(false);
        }
    };

    const handleLiquidate = async (loanId) => {
        try {
            setSubmitting(true);
            
            const res = await fetch(`/api/v1/lending/loans/${loanId}/liquidate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });

            const data = await res.json();
            if (data.success) {
                toast.success(`Liquidation successful! Seized: ${data.collateralSeized}`);
                fetchLendingData();
            } else {
                toast.error(data.error || 'Liquidation failed');
            }
        } catch (error) {
            console.error('Liquidate error:', error);
            toast.error('Liquidation failed');
        } finally {
            setSubmitting(false);
        }
    };

    const formatEther = (value) => {
        if (!value) return '0';
        try {
            // USDC is 6-decimal; use formatUnits to avoid 18-decimal formatEther mismatch
            return ethers.formatUnits(value.toString(), 6);
        } catch {
            return '0';
        }
    };

    const formatLTV = (ltv) => {
        if (!ltv) return '0%';
        return (ltv / 100).toFixed(2) + '%';
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'active': return 'text-green-600 bg-green-100';
            case 'repaid': return 'text-blue-600 bg-blue-100';
            case 'liquidated': return 'text-red-600 bg-red-100';
            case 'defaulted': return 'text-orange-600 bg-orange-100';
            default: return 'text-gray-600 bg-gray-100';
        }
    };

    const getLTVColor = (ltv) => {
        if (ltv > 8500) return 'text-red-600';
        if (ltv > 7000) return 'text-orange-600';
        return 'text-green-600';
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Dynamic Collateralized Lending</h2>

            {/* Eligibility Banner */}
            {eligibility && !eligibility.eligible && (
                <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <h3 className="font-semibold text-yellow-800">Lending Not Available</h3>
                    <p className="text-sm text-yellow-700 mt-1">
                        {eligibility.reason || 'Your credit score is below the minimum requirement.'}
                    </p>
                </div>
            )}

            {eligibility && eligibility.eligible && (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <h3 className="font-semibold text-green-800">You're Eligible!</h3>
                    <p className="text-sm text-green-700 mt-1">
                        Max Loan: ${formatEther(eligibility.maxLoanSize)} | 
                        Credit Score: {eligibility.creditScore} ({eligibility.grade?.label}) |
                        Interest Rate: {eligibility.interestRate}% APR |
                        Min Collateral: {eligibility.minCollateralRatio}%
                    </p>
                </div>
            )}

            {/* Tab Navigation */}
            <div className="mb-6 flex border-b border-gray-200">
                <button
                    onClick={() => setActiveTab('overview')}
                    className={`px-4 py-2 font-medium ${
                        activeTab === 'overview'
                            ? 'text-blue-600 border-b-2 border-blue-600'
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Overview
                </button>
                <button
                    onClick={() => setActiveTab('create')}
                    className={`px-4 py-2 font-medium ${
                        activeTab === 'create'
                            ? 'text-blue-600 border-b-2 border-blue-600'
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Create Loan
                </button>
                {userRole === 'investor' && (
                    <button
                        onClick={() => setActiveTab('liquidations')}
                        className={`px-4 py-2 font-medium ${
                            activeTab === 'liquidations'
                                ? 'text-blue-600 border-b-2 border-blue-600'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        Liquidations 🔥
                    </button>
                )}
            </div>

            {/* Overview Tab */}
            {activeTab === 'overview' && (
                <div>
                    {loans.length === 0 ? (
                        <div className="bg-white shadow rounded-lg p-6">
                            <p className="text-gray-500">No active loans. Create a new loan to get started.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {loans.map((loan) => (
                                <div key={loan.loan_id} className="bg-white shadow rounded-lg p-6">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="text-lg font-semibold">Loan {loan.loan_id.substring(0, 8)}...</h3>
                                            <span className={`text-xs px-2 py-1 rounded ${getStatusColor(loan.status)}`}>
                                                {loan.status.toUpperCase()}
                                            </span>
                                        </div>
                                        <div className="text-right">
                                            <p className={`text-xl font-bold ${getLTVColor(loan.ltv)}`}>
                                                LTV: {formatLTV(loan.ltv)}
                                            </p>
                                            {loan.is_undercollateralized && (
                                                <span className="text-xs text-red-600 font-semibold">
                                                    ⚠️ Undercollateralized
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                        <div>
                                            <p className="text-sm text-gray-500">Principal</p>
                                            <p className="font-semibold">${formatEther(loan.principal)}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-500">Total Debt</p>
                                            <p className="font-semibold">${formatEther(loan.total_debt)}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-500">Collateral</p>
                                            <p className="font-semibold">${formatEther(loan.collateral_value)}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-gray-500">Interest Rate</p>
                                            <p className="font-semibold">{(loan.interest_rate / 100).toFixed(2)}%</p>
                                        </div>
                                    </div>

                                    {loan.status === 'active' && (
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => {
                                                    setActiveTab(`borrow-${loan.loan_id}`);
                                                    setBorrowAmount('');
                                                }}
                                                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                            >
                                                Borrow More
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setActiveTab(`repay-${loan.loan_id}`);
                                                    setRepayAmount('');
                                                }}
                                                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                                            >
                                                Repay
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Create Loan Tab */}
            {activeTab === 'create' && eligibility?.eligible && (
                <div className="bg-white shadow rounded-lg p-6">
                    <h3 className="text-xl font-semibold mb-4">Create New Loan</h3>
                    <form onSubmit={handleCreateLoan}>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Borrow Amount (USDC)
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={borrowAmount}
                                onChange={(e) => setBorrowAmount(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Enter amount to borrow"
                            />
                            <p className="text-sm text-gray-500 mt-1">
                                Max: ${formatEther(eligibility.maxLoanSize)}
                            </p>
                        </div>
                        
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Collateral Value (USDC)
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={collateralValue}
                                onChange={(e) => setCollateralValue(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Enter collateral value"
                            />
                            <p className="text-sm text-gray-500 mt-1">
                                Min Required: {eligibility.minCollateralRatio}% of borrow amount
                            </p>
                        </div>

                        <button
                            type="submit"
                            disabled={submitting}
                            className={`w-full py-2 px-4 rounded-md text-white ${
                                submitting ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                        >
                            {submitting ? 'Processing...' : 'Create Loan'}
                        </button>
                    </form>
                </div>
            )}

            {/* Borrow More Tab */}
            {activeTab.startsWith('borrow-') && (
                <div className="bg-white shadow rounded-lg p-6">
                    <h3 className="text-xl font-semibold mb-4">Borrow Additional Funds</h3>
                    {(() => {
                        const loanId = activeTab.replace('borrow-', '');
                        const loan = loans.find(l => l.loan_id === loanId);
                        return (
                            <form onSubmit={(e) => handleBorrow(loanId, e)}>
                                <div className="mb-4">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Amount to Borrow (USDC)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={borrowAmount}
                                        onChange={(e) => setBorrowAmount(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="Enter amount to borrow"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                >
                                    {submitting ? 'Processing...' : 'Borrow'}
                                </button>
                            </form>
                        );
                    })()}
                </div>
            )}

            {/* Repay Tab */}
            {activeTab.startsWith('repay-') && (
                <div className="bg-white shadow rounded-lg p-6">
                    <h3 className="text-xl font-semibold mb-4">Repay Loan</h3>
                    {(() => {
                        const loanId = activeTab.replace('repay-', '');
                        const loan = loans.find(l => l.loan_id === loanId);
                        return (
                            <form onSubmit={(e) => handleRepay(loanId, e)}>
                                <div className="mb-4">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Repayment Amount (USDC)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={repayAmount}
                                        onChange={(e) => setRepayAmount(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="Enter amount to repay"
                                    />
                                    <p className="text-sm text-gray-600 mt-2">
                                        Total Debt: ${formatEther(loan?.total_debt || '0')}
                                    </p>
                                </div>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="w-full py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700"
                                >
                                    {submitting ? 'Processing...' : 'Repay'}
                                </button>
                            </form>
                        );
                    })()}
                </div>
            )}

            {/* Liquidations Tab (for investors) */}
            {activeTab === 'liquidations' && userRole === 'investor' && (
                <LiquidationCandidates onLiquidate={handleLiquidate} submitting={submitting} />
            )}

            {/* Info Section */}
            <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-blue-800">How Dynamic Collateralized Lending Works</h4>
                <ul className="text-sm text-blue-700 mt-2 space-y-1">
                    <li>• Your LTV (Loan-to-Value) is dynamically calculated based on credit risk</li>
                    <li>• Deposit invoice fractions (ERC1155) or escrow deposits as collateral</li>
                    <li>• Borrow against your collateral with competitive interest rates</li>
                    <li>• Higher credit scores can result in better LTV ratios</li>
                    <li>• Liquidators can seize collateral when LTV exceeds 85%</li>
                </ul>
            </div>
        </div>
    );
};

// Sub-component for liquidation candidates
const LiquidationCandidates = ({ onLiquidate, submitting }) => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchCandidates();
    }, []);

    const fetchCandidates = async () => {
        try {
            const res = await fetch('/api/v1/lending/liquidations?limit=10', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const data = await res.json();
            setCandidates(data.candidates || []);
        } catch (error) {
            console.error('Failed to fetch liquidation candidates:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatEther = (value) => {
        if (!value) return '0';
        try {
            return ethers.formatEther(value.toString());
        } catch {
            return '0';
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div>
            <h3 className="text-xl font-semibold mb-4">Liquidation Opportunities</h3>
            {candidates.length === 0 ? (
                <div className="bg-white shadow rounded-lg p-6">
                    <p className="text-gray-500">No liquidation opportunities available.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {candidates.map((loan) => (
                        <div key={loan.loan_id} className="bg-white shadow rounded-lg p-6 border-l-4 border-red-500">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h4 className="font-semibold">Loan {loan.loan_id.substring(0, 8)}...</h4>
                                    <p className="text-sm text-gray-600">
                                        Borrower: {loan.wallet_address?.substring(0, 6)}...{loan.wallet_address?.substring(38)}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-red-600 font-bold">LTV: {(loan.ltv / 100).toFixed(2)}%</p>
                                    <p className="text-sm text-gray-600">
                                        Debt: ${formatEther(loan.total_debt)}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => onLiquidate(loan.loan_id)}
                                disabled={submitting}
                                className="mt-4 w-full py-2 px-4 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400"
                            >
                                {submitting ? 'Processing...' : 'Liquidate & Seize Collateral'}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default LendingDashboard;
