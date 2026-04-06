import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-hot-toast';

const CreditLineTab = ({ userRole }) => {
    const [creditLine, setCreditLine] = useState(null);
    const [eligibility, setEligibility] = useState(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState('overview'); // overview, drawdown, repay, collateral
    
    // Form states
    const [drawdownAmount, setDrawdownAmount] = useState('');
    const [repayAmount, setRepayAmount] = useState('');
    const [collateralAmount, setCollateralAmount] = useState('');

    useEffect(() => {
        fetchCreditLineData();
    }, []);

    const fetchCreditLineData = async () => {
        try {
            setLoading(true);
            
            const eligibilityRes = await fetch(`${import.meta.env.VITE_API_URL}/v1/credit-line/eligibility`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const eligibilityData = await eligibilityRes.json();
            setEligibility(eligibilityData);

            const creditLineRes = await fetch(`${import.meta.env.VITE_API_URL}/v1/credit-line`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const creditLineData = await creditLineRes.json();
            setCreditLine(creditLineData.creditLine);
        } catch (error) {
            console.error('Failed to fetch credit line data:', error);
            toast.error('Failed to load credit line data');
        } finally {
            setLoading(false);
        }
    };

    const handleDrawdown = async (e) => {
        e.preventDefault();
        if (!drawdownAmount || parseFloat(drawdownAmount) <= 0) {
            toast.error('Please enter a valid amount');
            return;
        }

        try {
            setSubmitting(true);
            const amountWei = ethers.parseEther(drawdownAmount).toString();
            
            const res = await fetch(`${import.meta.env.VITE_API_URL}/v1/credit-line/drawdown`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    creditLineId: creditLine.credit_line_id,
                    amount: amountWei
                })
            });

            const data = await res.json();
            if (data.success) {
                toast.success(`Successfully drawn ${drawdownAmount}!`);
                setDrawdownAmount('');
                fetchCreditLineData();
            } else {
                toast.error(data.error || 'Drawdown failed');
            }
        } catch (error) {
            console.error('Drawdown error:', error);
            toast.error('Drawdown failed');
        } finally {
            setSubmitting(false);
        }
    };

    const handleRepay = async (e) => {
        e.preventDefault();
        if (!repayAmount || parseFloat(repayAmount) <= 0) {
            toast.error('Please enter a valid amount');
            return;
        }

        try {
            setSubmitting(true);
            const amountWei = ethers.parseEther(repayAmount).toString();

            const res = await fetch(`${import.meta.env.VITE_API_URL}/v1/credit-line/repay`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    creditLineId: creditLine.credit_line_id,
                    amount: amountWei
                })
            });

            const data = await res.json();
            if (data.success) {
                toast.success(`Successfully repaid ${repayAmount}!`);
                if (data.interestPaid && parseFloat(data.interestPaid) > 0) {
                    toast.success(`Interest paid: ${ethers.formatEther(data.interestPaid)}`);
                }
                setRepayAmount('');
                fetchCreditLineData();
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

    const formatEther = (value) => {
        if (!value) return '0';
        try {
            return ethers.formatEther(value.toString());
        } catch {
            return '0';
        }
    };

    const getGradeColor = (grade) => {
        switch (grade?.grade) {
            case 'A': return 'text-green-600';
            case 'B': return 'text-blue-600';
            case 'C': return 'text-yellow-600';
            case 'D': return 'text-orange-600';
            default: return 'text-red-600';
        }
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
            <h2 className="text-2xl font-bold mb-6">Revolving Credit Line</h2>

            {/* Eligibility Banner */}
            {eligibility && !eligibility.eligible && (
                <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <h3 className="font-semibold text-yellow-800">Credit Line Not Available</h3>
                    <p className="text-sm text-yellow-700 mt-1">
                        Your credit score ({eligibility.creditScore}) is below the minimum requirement (60).
                        Build your credit history to qualify for a revolving credit line.
                    </p>
                </div>
            )}

            {eligibility && eligibility.eligible && (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <h3 className="font-semibold text-green-800">You're Eligible!</h3>
                    <p className="text-sm text-green-700 mt-1">
                        Maximum Credit Limit: ${formatEther(eligibility.creditLimit)} | 
                        Credit Score: {eligibility.creditScore} ({eligibility.grade?.label})
                    </p>
                </div>
            )}

            {/* No Credit Line - Show Create Option */}
            {!creditLine && eligibility?.eligible && (
                <div className="bg-white shadow rounded-lg p-6">
                    <h3 className="text-xl font-semibold mb-4">Open a Credit Line</h3>
                    <p className="text-gray-600 mb-4">
                        Get access to flexible funding with your invoice fractions as collateral.
                        Draw funds as needed and only pay interest on what you use.
                    </p>
                    <div className="space-y-2 text-sm text-gray-600 mb-4">
                        <p>• Credit Limit: Up to ${formatEther(eligibility.creditLimit)}</p>
                        <p>• Interest Rate: 5% APR (variable based on risk)</p>
                        <p>• Collateral: 150% of credit limit in invoice fractions</p>
                        <p>• No origination fees</p>
                    </div>
                    <p className="text-sm text-blue-600">
                        To open a credit line, please use the financing modal and select "Credit Line" option.
                    </p>
                </div>
            )}

            {/* Credit Line Dashboard */}
            {creditLine && (
                <>
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
                            onClick={() => setActiveTab('drawdown')}
                            className={`px-4 py-2 font-medium ${
                                activeTab === 'drawdown'
                                    ? 'text-blue-600 border-b-2 border-blue-600'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Drawdown
                        </button>
                        <button
                            onClick={() => setActiveTab('repay')}
                            className={`px-4 py-2 font-medium ${
                                activeTab === 'repay'
                                    ? 'text-blue-600 border-b-2 border-blue-600'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Repay
                        </button>
                        <button
                            onClick={() => setActiveTab('collateral')}
                            className={`px-4 py-2 font-medium ${
                                activeTab === 'collateral'
                                    ? 'text-blue-600 border-b-2 border-blue-600'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Collateral
                        </button>
                    </div>

                    {/* Overview Tab */}
                    {activeTab === 'overview' && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-white shadow rounded-lg p-6">
                                <h4 className="text-gray-500 text-sm font-medium">Credit Limit</h4>
                                <p className="text-2xl font-bold text-gray-900">
                                    ${formatEther(creditLine.onChainData?.creditLimit || creditLine.credit_limit)}
                                </p>
                            </div>
                            <div className="bg-white shadow rounded-lg p-6">
                                <h4 className="text-gray-500 text-sm font-medium">Drawn Amount</h4>
                                <p className="text-2xl font-bold text-blue-600">
                                    ${formatEther(creditLine.onChainData?.drawnAmount || creditLine.drawn_amount)}
                                </p>
                            </div>
                            <div className="bg-white shadow rounded-lg p-6">
                                <h4 className="text-gray-500 text-sm font-medium">Available Credit</h4>
                                <p className="text-2xl font-bold text-green-600">
                                    ${formatEther(creditLine.availableCredit)}
                                </p>
                            </div>
                            <div className="bg-white shadow rounded-lg p-6">
                                <h4 className="text-gray-500 text-sm font-medium">Total Debt</h4>
                                <p className="text-2xl font-bold text-red-600">
                                    ${formatEther(creditLine.totalDebt)}
                                </p>
                            </div>
                            <div className="bg-white shadow rounded-lg p-6">
                                <h4 className="text-gray-500 text-sm font-medium">Interest Rate</h4>
                                <p className="text-2xl font-bold text-gray-900">
                                    {((creditLine.onChainData?.interestRate || creditLine.interest_rate) / 100).toFixed(2)}%
                                </p>
                            </div>
                            <div className="bg-white shadow rounded-lg p-6">
                                <h4 className="text-gray-500 text-sm font-medium">Collateral</h4>
                                <p className="text-2xl font-bold text-gray-900">
                                    ${formatEther(creditLine.onChainData?.collateralAmount || creditLine.collateral_amount)}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Drawdown Tab */}
                    {activeTab === 'drawdown' && (
                        <div className="bg-white shadow rounded-lg p-6">
                            <h3 className="text-xl font-semibold mb-4">Draw Funds</h3>
                            <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                                <p className="text-sm text-gray-600">
                                    Available Credit: <span className="font-bold text-green-600">${formatEther(creditLine.availableCredit)}</span>
                                </p>
                            </div>
                            <form onSubmit={handleDrawdown}>
                                <div className="mb-4">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Amount (USDC)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max={formatEther(creditLine.availableCredit)}
                                        value={drawdownAmount}
                                        onChange={(e) => setDrawdownAmount(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="Enter amount to draw"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={submitting || parseFloat(drawdownAmount) <= 0}
                                    className={`w-full py-2 px-4 rounded-md text-white ${
                                        submitting || parseFloat(drawdownAmount) <= 0
                                            ? 'bg-gray-400 cursor-not-allowed'
                                            : 'bg-blue-600 hover:bg-blue-700'
                                    }`}
                                >
                                    {submitting ? 'Processing...' : 'Draw Funds'}
                                </button>
                            </form>
                        </div>
                    )}

                    {/* Repay Tab */}
                    {activeTab === 'repay' && (
                        <div className="bg-white shadow rounded-lg p-6">
                            <h3 className="text-xl font-semibold mb-4">Repay Credit Line</h3>
                            <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                                <p className="text-sm text-gray-600">
                                    Total Debt: <span className="font-bold text-red-600">${formatEther(creditLine.totalDebt)}</span>
                                </p>
                                <p className="text-sm text-gray-600 mt-1">
                                    Principal: <span className="font-bold">${formatEther(creditLine.onChainData?.drawnAmount || creditLine.drawn_amount)}</span>
                                </p>
                            </div>
                            <form onSubmit={handleRepay}>
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
                                </div>
                                <div className="flex gap-2 mb-4">
                                    <button
                                        type="button"
                                        onClick={() => setRepayAmount(formatEther(creditLine.totalDebt))}
                                        className="text-sm text-blue-600 hover:underline"
                                    >
                                        Pay Full Amount
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setRepayAmount(formatEther(creditLine.onChainData?.drawnAmount || creditLine.drawn_amount))}
                                        className="text-sm text-blue-600 hover:underline"
                                    >
                                        Pay Principal Only
                                    </button>
                                </div>
                                <button
                                    type="submit"
                                    disabled={submitting || parseFloat(repayAmount) <= 0}
                                    className={`w-full py-2 px-4 rounded-md text-white ${
                                        submitting || parseFloat(repayAmount) <= 0
                                            ? 'bg-gray-400 cursor-not-allowed'
                                            : 'bg-green-600 hover:bg-green-700'
                                    }`}
                                >
                                    {submitting ? 'Processing...' : 'Repay'}
                                </button>
                            </form>
                        </div>
                    )}

                    {/* Collateral Tab */}
                    {activeTab === 'collateral' && (
                        <div className="bg-white shadow rounded-lg p-6">
                            <h3 className="text-xl font-semibold mb-4">Collateral Management</h3>
                            <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                                <p className="text-sm text-gray-600">
                                    Current Collateral: <span className="font-bold">${formatEther(creditLine.onChainData?.collateralAmount || creditLine.collateral_amount)}</span>
                                </p>
                                <p className="text-sm text-gray-600 mt-1">
                                    Token ID: {creditLine.collateral_token_id}
                                </p>
                                <p className="text-sm text-gray-600 mt-1">
                                    Min. Required (150%): ${formatEther((BigInt(creditLine.onChainData?.drawnAmount || creditLine.drawn_amount) * BigInt(150)) / BigInt(100))}
                                </p>
                            </div>
                            <p className="text-sm text-gray-600">
                                To add or remove collateral, please contact support or use advanced settings.
                            </p>
                        </div>
                    )}
                </>
            )}

            {/* Info Section */}
            <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-blue-800">How Revolving Credit Lines Work</h4>
                <ul className="text-sm text-blue-700 mt-2 space-y-1">
                    <li>• Your credit limit is determined by your credit score (60+ required)</li>
                    <li>• Deposit invoice fractions as collateral (150% of credit limit)</li>
                    <li>• Draw funds anytime up to your credit limit</li>
                    <li>• Pay interest only on the amount you use</li>
                    <li>• Repay and draw again - it "revolves" like a credit card</li>
                </ul>
            </div>
        </div>
    );
};

export default CreditLineTab;
