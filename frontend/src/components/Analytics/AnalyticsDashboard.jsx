import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { toast } from 'react-hot-toast';
import { getAnalyticsOverview, getPaymentAnalytics, getFinancingAnalytics, getRiskScore } from '../../utils/api';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

const AnalyticsDashboard = ({ userRole }) => {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [payments, setPayments] = useState(null);
  const [financing, setFinancing] = useState(null);
  const [riskInvoiceId, setRiskInvoiceId] = useState('');
  const [riskAssessment, setRiskAssessment] = useState(null);
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    fetchAnalyticsData();
  }, [userRole]);

  const fetchAnalyticsData = async () => {
    try {
      setLoading(true);
      
      // Fetch overview
      const overviewRes = await getAnalyticsOverview();
      if (overviewRes.data?.success) {
        setOverview(overviewRes.data.data);
      }

      // Fetch payment analytics
      const paymentRes = await getPaymentAnalytics();
      if (paymentRes.data?.success) {
        setPayments(paymentRes.data.data);
      }

      // Fetch financing analytics for seller/investor
      if (userRole === 'seller' || userRole === 'investor' || userRole === 'admin') {
        const financingRes = await getFinancingAnalytics();
        if (financingRes.data?.success) {
          setFinancing(financingRes.data.data);
        }
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
      toast.error('Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  const handleRiskAssessment = async (e) => {
    e.preventDefault();
    if (!riskInvoiceId) {
      toast.error('Please enter an invoice ID');
      return;
    }

    try {
      const res = await getRiskScore(riskInvoiceId);
      if (res.data?.success) {
        setRiskAssessment(res.data.data);
        toast.success('Risk assessment completed');
      }
    } catch (error) {
      console.error('Error fetching risk score:', error);
      toast.error(error.response?.data?.error || 'Failed to fetch risk assessment');
    }
  };

  const formatCurrency = (value) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    }
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(2)}K`;
    }
    return `$${value?.toFixed(2) || '0.00'}`;
  };

  // Prepare chart data
  const monthlyVolumeData = payments?.monthlyVolume?.map(item => ({
    month: item.month,
    volume: parseFloat(item.volume) || 0,
    count: parseInt(item.payment_count) || 0
  })) || [];

  const statusData = payments?.statusDistribution?.map((item, index) => ({
    name: item.status || 'Unknown',
    value: parseFloat(item.amount) || 0,
    count: parseInt(item.count) || 0,
    color: COLORS[index % COLORS.length]
  })) || [];

  const financingData = financing?.monthlyFinancing?.map(item => ({
    month: item.month,
    amount: parseFloat(item.amount) || 0,
    count: parseInt(item.invoice_count) || 0
  })) || [];

  const yieldData = financing?.yieldDistribution?.map((item, index) => ({
    name: `${(item.yield_bps / 100).toFixed(2)}%`,
    value: parseFloat(item.total_amount) || 0,
    count: parseInt(item.invoice_count) || 0,
    color: COLORS[index % COLORS.length]
  })) || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800">Analytics Dashboard</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveSection('overview')}
            className={`px-4 py-2 rounded-lg ${
              activeSection === 'overview'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveSection('payments')}
            className={`px-4 py-2 rounded-lg ${
              activeSection === 'payments'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Payments
          </button>
          {(userRole === 'seller' || userRole === 'investor' || userRole === 'admin') && (
            <button
              onClick={() => setActiveSection('financing')}
              className={`px-4 py-2 rounded-lg ${
                activeSection === 'financing'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Financing
            </button>
          )}
          <button
            onClick={() => setActiveSection('risk')}
            className={`px-4 py-2 rounded-lg ${
              activeSection === 'risk'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Risk Assessment
          </button>
        </div>
      </div>

      {/* Overview Section */}
      {activeSection === 'overview' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {userRole === 'seller' && overview?.invoices && (
              <>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-sm text-gray-500">Total Invoices</p>
                  <p className="text-2xl font-bold text-gray-800">{overview.invoices.total}</p>
                  <p className="text-sm text-green-600">{overview.invoices.completed} completed</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-sm text-gray-500">Total Amount</p>
                  <p className="text-2xl font-bold text-gray-800">{formatCurrency(overview.invoices.totalAmount)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-sm text-gray-500">Tokenized</p>
                  <p className="text-2xl font-bold text-blue-600">{overview.invoices.tokenized}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-sm text-gray-500">Pending</p>
                  <p className="text-2xl font-bold text-yellow-600">{overview.invoices.pending}</p>
                </div>
              </>
            )}

            {userRole === 'investor' && overview?.marketplace && (
              <>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-sm text-gray-500">Marketplace Listings</p>
                  <p className="text-2xl font-bold text-gray-800">{overview.marketplace.totalListed}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-sm text-gray-500">Total Value</p>
                  <p className="text-2xl font-bold text-gray-800">{formatCurrency(overview.marketplace.totalValue)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-sm text-gray-500">Available</p>
                  <p className="text-2xl font-bold text-green-600">{overview.marketplace.available}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-sm text-gray-500">Avg Yield</p>
                  <p className="text-2xl font-bold text-blue-600">{(overview.marketplace.averageYield / 100).toFixed(2)}%</p>
                </div>
              </>
            )}

            {userRole === 'buyer' && overview?.payments && (
              <>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-sm text-gray-500">Total Payments</p>
                  <p className="text-2xl font-bold text-gray-800">{overview.payments.total}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-sm text-gray-500">Total Spent</p>
                  <p className="text-2xl font-bold text-gray-800">{formatCurrency(overview.payments.totalSpent)}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-sm text-gray-500">Completed</p>
                  <p className="text-2xl font-bold text-green-600">{overview.payments.completed}</p>
                </div>
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-sm text-gray-500">Pending</p>
                  <p className="text-2xl font-bold text-yellow-600">{overview.payments.pending}</p>
                </div>
              </>
            )}
          </div>

          {/* Quick Charts */}
          {userRole === 'seller' && financingData.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Monthly Financing Volume</h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={financingData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={formatCurrency} />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Area type="monotone" dataKey="amount" stroke="#2563EB" fill="#93C5FD" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Payments Section */}
      {activeSection === 'payments' && payments && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm text-gray-500">Total Payments</p>
              <p className="text-2xl font-bold text-gray-800">{payments.summary.totalPayments}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm text-gray-500">Total Volume</p>
              <p className="text-2xl font-bold text-gray-800">{formatCurrency(payments.summary.totalVolume)}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm text-gray-500">Average Amount</p>
              <p className="text-2xl font-bold text-gray-800">{formatCurrency(payments.summary.averageAmount)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Payment Volume Chart */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Payment Volume Over Time</h3>
              {monthlyVolumeData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={monthlyVolumeData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={formatCurrency} />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Legend />
                    <Line type="monotone" dataKey="volume" stroke="#2563EB" name="Volume" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-500 text-center py-8">No payment data available</p>
              )}
            </div>

            {/* Payment Status Distribution */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Payment Status Distribution</h3>
              {statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-500 text-center py-8">No status data available</p>
              )}
            </div>
          </div>

          {/* Monthly Revenue Bar Chart */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Monthly Revenue</h3>
            {monthlyVolumeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyVolumeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={formatCurrency} />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Legend />
                  <Bar dataKey="volume" fill="#2563EB" name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-gray-500 text-center py-8">No revenue data available</p>
            )}
          </div>
        </div>
      )}

      {/* Financing Section */}
      {activeSection === 'financing' && financing && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm text-gray-500">Total Financed</p>
              <p className="text-2xl font-bold text-gray-800">{financing.summary.totalFinanced}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm text-gray-500">Currently Listed</p>
              <p className="text-2xl font-bold text-blue-600">{financing.summary.currentlyListed}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <p className="text-sm text-gray-500">Actively Financed</p>
              <p className="text-2xl font-bold text-green-600">{financing.summary.activelyFinanced}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly Financing Chart */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Monthly Financing</h3>
              {financingData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={financingData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={formatCurrency} />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Area type="monotone" dataKey="amount" stroke="#10B981" fill="#6EE7B7" />
                  </AreaChart>
               
      </ResponsiveContainer> ) : (
                <p className="text-gray-500 text-center py-8">No financing data available</p>
              )}
            </div>

            {/* Yield Distribution */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Yield Distribution</h3>
              {yieldData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={yieldData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {yieldData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-500 text-center py-8">No yield data available</p>
              )}
            </div>
          </div>

          {/* ROI Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Return Metrics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-600">Average Yield</p>
                <p className="text-2xl font-bold text-blue-800">{(financing.roi.averageYield / 100).toFixed(2)}%</p>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <p className="text-sm text-green-600">Estimated Returns</p>
                <p className="text-2xl font-bold text-green-800">{formatCurrency(financing.roi.estimatedReturns)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Risk Assessment Section */}
      {activeSection === 'risk' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Invoice Risk Assessment</h3>
            <form onSubmit={handleRiskAssessment} className="flex gap-4 mb-6">
              <input
                type="text"
                value={riskInvoiceId}
                onChange={(e) => setRiskInvoiceId(e.target.value)}
                placeholder="Enter Invoice ID"
                className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Assess Risk
              </button>
            </form>

            {riskAssessment && (
              <div className="space-y-6">
                {/* Risk Score Card */}
                <div className="flex items-center justify-between p-6 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm text-gray-500">Risk Score</p>
                    <p className="text-4xl font-bold">{riskAssessment.riskScore}/100</p>
                  </div>
                  <div className={`px-4 py-2 rounded-lg ${
                    riskAssessment.riskLevel === 'low' ? 'bg-green-100 text-green-800' :
                    riskAssessment.riskLevel === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    <span className="text-lg font-semibold capitalize">{riskAssessment.riskLevel} Risk</span>
                  </div>
                </div>

                {/* Recommendation */}
                <div className={`p-4 rounded-lg ${
                  riskAssessment.recommendation.action === 'invest' ? 'bg-green-50 border-green-200' :
                  riskAssessment.recommendation.action === 'caution' ? 'bg-yellow-50 border-yellow-200' :
                  'bg-red-50 border-red-200'
                } border`}>
                  <p className="font-semibold mb-1 capitalize">{riskAssessment.recommendation.action}</p>
                  <p className="text-gray-700">{riskAssessment.recommendation.message}</p>
                </div>

                {/* Risk Factors */}
                <div>
                  <h4 className="font-semibold mb-3">Risk Factors</h4>
                  <div className="space-y-2">
                    {riskAssessment.riskFactors.map((factor, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium">{factor.factor}</p>
                          <p className="text-sm text-gray-500">{factor.description}</p>
                        </div>
                        <span className={`px-2 py-1 text-xs rounded ${
                          factor.impact === 'high' ? 'bg-red-100 text-red-800' :
                          factor.impact === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {factor.impact}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Invoice Details */}
                {riskAssessment.invoiceDetails && (
                  <div>
                    <h4 className="font-semibold mb-3">Invoice Details</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-500">Amount</p>
                        <p className="font-semibold">{formatCurrency(riskAssessment.invoiceDetails.amount)}</p>
                      </div>
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-500">Currency</p>
                        <p className="font-semibold">{riskAssessment.invoiceDetails.currency}</p>
                      </div>
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-500">Status</p>
                        <p className="font-semibold">{riskAssessment.invoiceDetails.status}</p>
                      </div>
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-500">Financing</p>
                        <p className="font-semibold">{riskAssessment.invoiceDetails.financingStatus}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsDashboard;
