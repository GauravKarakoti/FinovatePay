import React, { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { toast } from 'sonner';
import { getFraudAlerts, getFraudSummary, updateFraudAlertStatus } from '../../utils/api';

const severityStyles = {
  low: 'bg-blue-100 text-blue-700 border-blue-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  critical: 'bg-red-100 text-red-700 border-red-200'
};

const statusStyles = {
  open: 'bg-red-100 text-red-700',
  investigating: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
  dismissed: 'bg-slate-100 text-slate-700'
};

const FraudAlerts = ({ compact = false }) => {
  const [alerts, setAlerts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [statusFilter, setStatusFilter] = useState('open');
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const loadAlerts = useCallback(async () => {
    setIsLoading(true);
    try {
      const [alertsResponse, summaryResponse] = await Promise.all([
        getFraudAlerts({ status: statusFilter, limit: compact ? 10 : 25 }),
        getFraudSummary()
      ]);

      setAlerts(Array.isArray(alertsResponse?.data?.data) ? alertsResponse.data.data : []);
      setSummary(summaryResponse?.data?.data || null);
    } catch (error) {
      console.error('[FraudAlerts] Failed to load alerts:', error);
      toast.error('Unable to load fraud alerts');
    } finally {
      setIsLoading(false);
    }
  }, [compact, statusFilter]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const handleStatusUpdate = async (alertId, status) => {
    setIsUpdating(true);
    try {
      await updateFraudAlertStatus(alertId, status, `Updated by admin from dashboard to ${status}`);
      toast.success(`Alert marked as ${status}`);
      await loadAlerts();
    } catch (error) {
      console.error('[FraudAlerts] Failed to update alert status:', error);
      toast.error('Failed to update alert status');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">AI Fraud Alerts</h3>
          <p className="text-sm text-gray-500">Real-time suspicious activity review queue</p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="fraud-status-filter" className="text-sm text-gray-600">Status</label>
          <select
            id="fraud-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>
      </div>

      {summary && (
        <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-3 bg-gray-50 border-b border-gray-200">
          <div className="p-3 rounded bg-white border border-gray-200">
            <p className="text-xs text-gray-500">Open</p>
            <p className="text-xl font-bold text-red-600">{summary.alerts?.open_alerts || 0}</p>
          </div>
          <div className="p-3 rounded bg-white border border-gray-200">
            <p className="text-xs text-gray-500">Investigating</p>
            <p className="text-xl font-bold text-amber-600">{summary.alerts?.investigating_alerts || 0}</p>
          </div>
          <div className="p-3 rounded bg-white border border-gray-200">
            <p className="text-xs text-gray-500">Resolved</p>
            <p className="text-xl font-bold text-green-600">{summary.alerts?.resolved_alerts || 0}</p>
          </div>
          <div className="p-3 rounded bg-white border border-gray-200">
            <p className="text-xs text-gray-500">Dismissed</p>
            <p className="text-xl font-bold text-slate-600">{summary.alerts?.dismissed_alerts || 0}</p>
          </div>
        </div>
      )}

      <div className="p-4 md:p-6">
        {isLoading ? (
          <div className="py-10 text-center text-gray-500">Loading fraud alerts...</div>
        ) : alerts.length === 0 ? (
          <div className="py-10 text-center text-gray-500">No alerts found for this status.</div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <article key={alert.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-semibold text-gray-900">{alert.title || alert.alert_code}</h4>
                    <p className="text-sm text-gray-500">Alert #{alert.id} - {alert.alert_code}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs border ${severityStyles[alert.severity] || severityStyles.medium}`}>
                      {alert.severity}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs ${statusStyles[alert.status] || statusStyles.open}`}>
                      {alert.status}
                    </span>
                  </div>
                </div>

                <div className="mt-3 text-sm text-gray-700 space-y-1">
                  <p>{alert.description || 'No description provided.'}</p>
                  <p>
                    Risk Score: <span className="font-semibold">{alert.risk_score ?? 'N/A'}</span>
                    {' '}| Type: <span className="font-semibold">{alert.transaction_type || 'unknown'}</span>
                    {' '}| Amount: <span className="font-semibold">{alert.amount || 0} {alert.currency || ''}</span>
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    disabled={isUpdating}
                    onClick={() => handleStatusUpdate(alert.id, 'investigating')}
                    className="px-3 py-1.5 text-xs font-medium rounded bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-60"
                  >
                    Mark Investigating
                  </button>
                  <button
                    disabled={isUpdating}
                    onClick={() => handleStatusUpdate(alert.id, 'resolved')}
                    className="px-3 py-1.5 text-xs font-medium rounded bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-60"
                  >
                    Resolve
                  </button>
                  <button
                    disabled={isUpdating}
                    onClick={() => handleStatusUpdate(alert.id, 'dismissed')}
                    className="px-3 py-1.5 text-xs font-medium rounded bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60"
                  >
                    Dismiss
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

FraudAlerts.propTypes = {
  compact: PropTypes.bool
};

export default FraudAlerts;
