import { useState, useEffect } from 'react';
import pushNotificationService from '../../services/pushNotificationService';

const PermissionBanner = ({ onSubscriptionChange }) => {
  const [permission, setPermission] = useState('default');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [preferences, setPreferences] = useState({
    escrow_created: true,
    escrow_funded: true,
    escrow_released: true,
    dispute_raised: true,
    dispute_resolved: true,
    auction_outbid: true,
    auction_ending: true,
    payment_received: true,
    kyc_status: true,
    enabled: true
  });

  useEffect(() => {
    checkPermissionStatus();
    loadPreferences();
  }, []);

  const checkPermissionStatus = async () => {
    const status = pushNotificationService.getPermissionStatus();
    setPermission(status);

    // Check if already subscribed
    const subs = await pushNotificationService.getSubscriptions();
    if (subs.success && subs.subscriptions.length > 0) {
      setIsSubscribed(true);
    }
  };

  const loadPreferences = async () => {
    const result = await pushNotificationService.getPreferences();
    if (result.success && result.preferences) {
      setPreferences({
        escrow_created: result.preferences.escrow_created,
        escrow_funded: result.preferences.escrow_funded,
        escrow_released: result.preferences.escrow_released,
        dispute_raised: result.preferences.dispute_raised,
        dispute_resolved: result.preferences.dispute_resolved,
        auction_outbid: result.preferences.auction_outbid,
        auction_ending: result.preferences.auction_ending,
        payment_received: result.preferences.payment_received,
        kyc_status: result.preferences.kyc_status,
        enabled: result.preferences.enabled
      });
    }
  };

  const handleEnableNotifications = async () => {
    setIsLoading(true);
    try {
      // First request permission
      const permissionResult = await pushNotificationService.requestPermission();
      setPermission(permissionResult);

      if (permissionResult === 'granted') {
        // Then subscribe
        const result = await pushNotificationService.subscribe();
        if (result.success) {
          setIsSubscribed(true);
          if (onSubscriptionChange) {
            onSubscriptionChange(true);
          }
        } else {
          console.error('Failed to subscribe:', result.error);
        }
      }
    } catch (error) {
      console.error('Error enabling notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisableNotifications = async () => {
    setIsLoading(true);
    try {
      const result = await pushNotificationService.unsubscribe();
      if (result.success) {
        setIsSubscribed(false);
        if (onSubscriptionChange) {
          onSubscriptionChange(false);
        }
      }
    } catch (error) {
      console.error('Error disabling notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreferenceChange = async (key, value) => {
    const newPreferences = { ...preferences, [key]: value };
    setPreferences(newPreferences);

    const result = await pushNotificationService.updatePreferences(newPreferences);
    if (!result.success) {
      console.error('Failed to update preferences');
      // Revert on failure
      setPreferences(preferences);
    }
  };

  // Don't show banner if notifications are not supported
  if (permission === 'unsupported') {
    return null;
  }

  // Show settings panel
  if (showSettings) {
    return (
      <div className="fixed bottom-4 right-4 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Notification Settings</h3>
            <button
              onClick={() => setShowSettings(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-4 max-h-96 overflow-y-auto">
          <div className="space-y-3">
            {/* Master toggle */}
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="font-medium text-gray-700">Enable Notifications</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={preferences.enabled}
                  onChange={(e) => handlePreferenceChange('enabled', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Individual toggles */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-500 mt-4">Notification Types</p>
              
              <NotificationToggle
                label="Escrow Created"
                checked={preferences.escrow_created}
                onChange={(v) => handlePreferenceChange('escrow_created', v)}
                disabled={!preferences.enabled}
              />
              
              <NotificationToggle
                label="Funds Deposited"
                checked={preferences.escrow_funded}
                onChange={(v) => handlePreferenceChange('escrow_funded', v)}
                disabled={!preferences.enabled}
              />
              
              <NotificationToggle
                label="Escrow Released"
                checked={preferences.escrow_released}
                onChange={(v) => handlePreferenceChange('escrow_released', v)}
                disabled={!preferences.enabled}
              />
              
              <NotificationToggle
                label="Dispute Raised"
                checked={preferences.dispute_raised}
                onChange={(v) => handlePreferenceChange('dispute_raised', v)}
                disabled={!preferences.enabled}
              />
              
              <NotificationToggle
                label="Dispute Resolved"
                checked={preferences.dispute_resolved}
                onChange={(v) => handlePreferenceChange('dispute_resolved', v)}
                disabled={!preferences.enabled}
              />
              
              <NotificationToggle
                label="Auction Outbid"
                checked={preferences.auction_outbid}
                onChange={(v) => handlePreferenceChange('auction_outbid', v)}
                disabled={!preferences.enabled}
              />
              
              <NotificationToggle
                label="Auction Ending"
                checked={preferences.auction_ending}
                onChange={(v) => handlePreferenceChange('auction_ending', v)}
                disabled={!preferences.enabled}
              />
              
              <NotificationToggle
                label="Payment Received"
                checked={preferences.payment_received}
                onChange={(v) => handlePreferenceChange('payment_received', v)}
                disabled={!preferences.enabled}
              />
              
              <NotificationToggle
                label="KYC Status Update"
                checked={preferences.kyc_status}
                onChange={(v) => handlePreferenceChange('kyc_status', v)}
                disabled={!preferences.enabled}
              />
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200">
          <button
            onClick={handleDisableNotifications}
            disabled={isLoading}
            className="w-full px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : 'Unsubscribe All'}
          </button>
        </div>
      </div>
    );
  }

  // Show nothing if already granted and subscribed (or denied)
  if (permission === 'denied') {
    return (
      <div className="fixed bottom-4 right-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4 shadow-lg z-50 max-w-sm">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🔔</span>
          <div>
            <p className="text-sm text-yellow-800 font-medium">
              Notifications Blocked
            </p>
            <p className="text-xs text-yellow-600 mt-1">
              Please enable notifications in your browser settings to receive alerts.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (permission === 'granted' && isSubscribed) {
    return (
      <div className="fixed bottom-4 right-4 bg-white border border-gray-200 rounded-lg p-4 shadow-lg z-50 max-w-sm">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔔</span>
          <div className="flex-1">
            <p className="text-sm text-gray-700 font-medium">
              Notifications Enabled
            </p>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Settings
          </button>
        </div>
      </div>
    );
  }

  // Show banner to request permission
  return (
    <div className="fixed bottom-4 right-4 bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg p-4 shadow-lg z-50 max-w-sm text-white">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🔔</span>
        <div className="flex-1">
          <p className="text-sm font-medium">
            Enable Push Notifications
          </p>
          <p className="text-xs text-blue-100 mt-1">
            Get real-time alerts for escrow, disputes, and auction updates.
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={handleEnableNotifications}
          disabled={isLoading}
          className="flex-1 px-3 py-2 text-sm font-medium bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Enabling...' : 'Enable'}
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="px-3 py-2 text-sm font-medium text-blue-100 hover:text-white transition-colors"
        >
          Settings
        </button>
      </div>
    </div>
  );
};

// Helper component for notification toggles
const NotificationToggle = ({ label, checked, onChange, disabled }) => (
  <div className="flex items-center justify-between py-1">
    <span className={`text-sm ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>
      {label}
    </span>
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only peer"
      />
      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 disabled:opacity-50"></div>
    </label>
  </div>
);

export default PermissionBanner;
