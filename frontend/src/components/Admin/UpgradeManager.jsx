import { useState, useEffect } from 'react';
import api from '../../utils/api';
import './UpgradeManager.css';

const UpgradeManager = () => {
  const [proxies, setProxies] = useState([]);
  const [stats, setStats] = useState({ totalProxies: 0, activeProxies: 0, totalUpgrades: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedProxy, setSelectedProxy] = useState(null);
  const [upgradeHistory, setUpgradeHistory] = useState([]);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [newImplementation, setNewImplementation] = useState('');
  const [newVersion, setNewVersion] = useState('');
  const [upgradeReason, setUpgradeReason] = useState('');
  const [upgrading, setUpgrading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);

  useEffect(() => {
    fetchProxies();
    fetchStats();
  }, []);

  const fetchProxies = async () => {
    try {
      setLoading(true);
      const response = await api.get('/proxy');
      if (response.data.success) {
        // DEFENSIVE: Ensure it's always an array
        setProxies(Array.isArray(response.data.proxies) ? response.data.proxies : []);
      }
    } catch (err) {
      console.error('Error fetching proxies:', err);
      setError('Failed to fetch proxy contracts');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await api.get('/proxy/stats');
      if (response.data.success) {
        // DEFENSIVE: Fallback to initial state if stats object is missing
        setStats(response.data.stats || { totalProxies: 0, activeProxies: 0, totalUpgrades: 0 });
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchUpgradeHistory = async (contractName) => {
    try {
      const response = await api.get(`/proxy/${contractName}/history`);
      if (response.data.success) {
        // DEFENSIVE: Ensure it's always an array
        setUpgradeHistory(Array.isArray(response.data.history) ? response.data.history : []);
      }
    } catch (err) {
      console.error('Error fetching upgrade history:', err);
    }
  };

  const handleSelectProxy = async (proxy) => {
    setSelectedProxy(proxy);
    await fetchUpgradeHistory(proxy.contract_name);
  };

  const handleVerify = async (contractName) => {
    try {
      setVerifying(true);
      setVerificationResult(null);
      const response = await api.post(`/proxy/verify/${contractName}`);
      setVerificationResult(response.data);
    } catch (err) {
      console.error('Error verifying proxy:', err);
      setError('Failed to verify proxy integrity');
    } finally {
      setVerifying(false);
    }
  };

  const handleUpgrade = async (e) => {
    e.preventDefault();
    if (!selectedProxy) return;

    try {
      setUpgrading(true);
      setError('');

      const response = await api.post('/proxy/upgrade', {
        contractName: selectedProxy.contract_name,
        newImplementationAddress: newImplementation,
        newVersion: parseInt(newVersion),
        reason: upgradeReason
      });

      if (response.data.success) {
        alert('Proxy upgraded successfully!');
        setShowUpgradeModal(false);
        setNewImplementation('');
        setNewVersion('');
        setUpgradeReason('');
        fetchProxies();
        fetchStats();
        handleSelectProxy({ ...selectedProxy, implementation_address: newImplementation, version: parseInt(newVersion) });
      }
    } catch (err) {
      console.error('Error upgrading proxy:', err);
      setError(err.response?.data?.message || 'Failed to upgrade proxy');
    } finally {
      setUpgrading(false);
    }
  };

  const handlePause = async (contractName) => {
    try {
      const response = await api.post(`/proxy/pause/${contractName}`);
      if (response.data.success) {
        alert('Proxy paused successfully');
        fetchProxies();
      }
    } catch (err) {
      console.error('Error pausing proxy:', err);
      setError('Failed to pause proxy');
    }
  };

  const handleUnpause = async (contractName) => {
    try {
      const response = await api.post(`/proxy/unpause/${contractName}`);
      if (response.data.success) {
        alert('Proxy reactivated successfully');
        fetchProxies();
      }
    } catch (err) {
      console.error('Error unpausing proxy:', err);
      setError('Failed to reactivate proxy');
    }
  };

  const formatAddress = (address) => {
    if (!address) return 'N/A';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
  };

  // DEFENSIVE: Fallback checking against proxies.length safely
  if (loading && (!proxies || proxies.length === 0)) {
    return (
      <div className="upgrade-manager">
        <div className="loading-spinner">Loading...</div>
      </div>
    );
  }

  return (
    <div className="upgrade-manager">
      <div className="upgrade-manager-header">
        <h1>Contract Upgrade Manager</h1>
        <p>Manage UUPS upgradeable proxy contracts</p>
      </div>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      {/* Stats Overview */}
      <div className="stats-grid">
        <div className="stat-card">
          {/* DEFENSIVE OPTIONAL CHAINING */}
          <div className="stat-value">{stats?.totalProxies || 0}</div>
          <div className="stat-label">Total Proxies</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats?.activeProxies || 0}</div>
          <div className="stat-label">Active Proxies</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats?.totalUpgrades || 0}</div>
          <div className="stat-label">Total Upgrades</div>
        </div>
      </div>

      {/* Proxies List */}
      <div className="proxies-section">
        <h2>Deployed Proxy Contracts</h2>
        
        {!proxies || proxies.length === 0 ? (
          <div className="empty-state">
            <p>No proxy contracts deployed yet.</p>
          </div>
        ) : (
          <div className="proxies-table-container">
            <table className="proxies-table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Proxy Address</th>
                  <th>Implementation</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Deployed</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {proxies.map((proxy) => (
                  <tr 
                    key={proxy.contract_name}
                    className={selectedProxy?.contract_name === proxy.contract_name ? 'selected' : ''}
                    onClick={() => handleSelectProxy(proxy)}
                  >
                    <td>{proxy.contract_name}</td>
                    <td className="address-cell" title={proxy.proxy_address}>
                      {formatAddress(proxy.proxy_address)}
                    </td>
                    <td className="address-cell" title={proxy.implementation_address}>
                      {formatAddress(proxy.implementation_address)}
                    </td>
                    <td>v{proxy.version}</td>
                    <td>
                      <span className={`status-badge ${proxy.is_active ? 'active' : 'paused'}`}>
                        {proxy.is_active ? 'Active' : 'Paused'}
                      </span>
                      {proxy.isVerified === false && (
                        <span className="warning-badge" title="Implementation mismatch">!</span>
                      )}
                    </td>
                    <td>{formatDate(proxy.deployed_at)}</td>
                    <td className="actions-cell">
                      <button 
                        className="btn btn-sm btn-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleVerify(proxy.contract_name);
                        }}
                        disabled={verifying}
                      >
                        {verifying ? 'Verifying...' : 'Verify'}
                      </button>
                      <button 
                        className="btn btn-sm btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProxy(proxy);
                          setShowUpgradeModal(true);
                        }}
                      >
                        Upgrade
                      </button>
                      {proxy.is_active ? (
                        <button 
                          className="btn btn-sm btn-warning"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePause(proxy.contract_name);
                          }}
                        >
                          Pause
                        </button>
                      ) : (
                        <button 
                          className="btn btn-sm btn-success"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnpause(proxy.contract_name);
                          }}
                        >
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Selected Proxy Details */}
      {selectedProxy && (
        <div className="proxy-details">
          <h2>Proxy Details: {selectedProxy.contract_name}</h2>
          
          <div className="details-grid">
            <div className="detail-item">
              <label>Proxy Address:</label>
              <span className="address">{selectedProxy.proxy_address}</span>
            </div>
            <div className="detail-item">
              <label>Implementation:</label>
              <span className="address">{selectedProxy.implementation_address}</span>
            </div>
            <div className="detail-item">
              <label>Admin:</label>
              <span className="address">{selectedProxy.admin_address}</span>
            </div>
            <div className="detail-item">
              <label>Version:</label>
              <span>v{selectedProxy.version}</span>
            </div>
            <div className="detail-item">
              <label>Status:</label>
              <span className={`status-badge ${selectedProxy.is_active ? 'active' : 'paused'}`}>
                {selectedProxy.is_active ? 'Active' : 'Paused'}
              </span>
            </div>
            <div className="detail-item">
              <label>Deployed:</label>
              <span>{formatDate(selectedProxy.deployed_at)}</span>
            </div>
          </div>

          {/* Upgrade History */}
          <div className="upgrade-history">
            <h3>Upgrade History</h3>
            {!upgradeHistory || upgradeHistory.length === 0 ? (
              <p className="empty-history">No upgrades recorded yet.</p>
            ) : (
              <div className="history-list">
                {upgradeHistory.map((record, index) => (
                  <div key={index} className="history-item">
                    <div className="history-header">
                      <span className="version">v{record.new_version}</span>
                      <span className="date">{formatDate(record.upgraded_at)}</span>
                    </div>
                    <div className="history-details">
                      <div className="implementation-change">
                        <span className="label">From:</span>
                        <span className="address">{formatAddress(record.old_implementation)}</span>
                      </div>
                      <div className="implementation-change">
                        <span className="label">To:</span>
                        <span className="address">{formatAddress(record.new_implementation)}</span>
                      </div>
                    </div>
                    <div className="history-footer">
                      <span className="upgraded-by">By: {formatAddress(record.upgraded_by)}</span>
                      {record.upgrade_reason && (
                        <span className="reason">{record.upgrade_reason}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Verification Result */}
      {verificationResult && (
        <div className={`verification-result ${verificationResult.verified ? 'success' : 'error'}`}>
          <h3>Verification Result</h3>
          {verificationResult.verified ? (
            <p>✓ Proxy integrity verified. On-chain implementation matches database.</p>
          ) : (
            <p>✗ Verification failed: {verificationResult.reason}</p>
          )}
          <button onClick={() => setVerificationResult(null)}>Close</button>
        </div>
      )}

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="modal-overlay" onClick={() => setShowUpgradeModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Upgrade Proxy: {selectedProxy?.contract_name}</h2>
              <button className="close-btn" onClick={() => setShowUpgradeModal(false)}>×</button>
            </div>
            <form onSubmit={handleUpgrade}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Current Implementation:</label>
                  <div className="current-value">{selectedProxy?.implementation_address}</div>
                </div>
                <div className="form-group">
                  <label>Current Version:</label>
                  <div className="current-value">v{selectedProxy?.version}</div>
                </div>
                <div className="form-group">
                  <label htmlFor="newImplementation">New Implementation Address *</label>
                  <input
                    type="text"
                    id="newImplementation"
                    value={newImplementation}
                    onChange={(e) => setNewImplementation(e.target.value)}
                    placeholder="0x..."
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="newVersion">New Version *</label>
                  <input
                    type="number"
                    id="newVersion"
                    value={newVersion}
                    onChange={(e) => setNewVersion(e.target.value)}
                    placeholder="3"
                    min="1"
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="upgradeReason">Upgrade Reason</label>
                  <textarea
                    id="upgradeReason"
                    value={upgradeReason}
                    onChange={(e) => setUpgradeReason(e.target.value)}
                    placeholder="Describe the reason for this upgrade..."
                    rows="3"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn btn-secondary"
                  onClick={() => setShowUpgradeModal(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={upgrading || !newImplementation || !newVersion}
                >
                  {upgrading ? 'Upgrading...' : 'Upgrade Contract'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UpgradeManager;