/**
 * Network utility module for robust offline detection
 * Provides a more reliable way to detect actual internet connectivity
 * beyond the unreliable navigator.onLine property
 */

// Cache for offline state to avoid repeated network calls
let cachedOfflineState = false;
let lastCheckTime = 0;
const CACHE_DURATION = 5000; // 5 seconds cache

// Configuration for the connectivity check
const CONNECTIVITY_CHECK_CONFIG = {
  timeout: 5000, // 5 second timeout
  // Use a reliable, lightweight endpoint for connectivity check
  // Using Google's DNS check endpoint (highly available)
  checkUrl: 'https://www.google.com/generate_204',
  // Fallback endpoints if primary fails
  fallbackUrls: [
    'https://clients3.google.com/generate_204',
    'https://www.gstatic.com/generate_204'
  ]
};

/**
 * Attempt to verify actual internet connectivity by making a fetch request
 * This goes beyond navigator.onLine which only checks local network connectivity
 * @returns {Promise<boolean>} - True if online, false if offline
 */
const checkConnectivity = async () => {
  const { timeout, checkUrl, fallbackUrls } = CONNECTIVITY_CHECK_CONFIG;
  
  const tryFetch = async (url) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        method: 'HEAD',
        mode: 'no-cors', // no-cors ensures we don't get CORS errors
        cache: 'no-store',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return true;
    } catch (error) {
      return false;
    }
  };

  // Try primary URL first
  if (await tryFetch(checkUrl)) {
    return true;
  }

  // Try fallback URLs
  for (const url of fallbackUrls) {
    if (await tryFetch(url)) {
      return true;
    }
  }

  return false;
};

/**
 * Check if the user is online using a robust strategy
 * Uses cached state if checked recently, otherwise performs actual connectivity check
 * @returns {Promise<boolean>} - True if online, false if offline
 */
export const checkOnlineStatus = async () => {
  const now = Date.now();
  
  // Return cached state if checked recently (within CACHE_DURATION)
  if (now - lastCheckTime < CACHE_DURATION && cachedOfflineState !== null) {
    console.log('Using cached online status:', !cachedOfflineState);
    return !cachedOfflineState;
  }

  // First, check navigator.onLine as a quick preliminary check
  if (!navigator.onLine) {
    console.log('Navigator reports offline');
    cachedOfflineState = true;
    lastCheckTime = now;
    return false;
  }

  // If navigator.onLine is true, verify with actual connectivity check
  const isConnected = await checkConnectivity();
  
  cachedOfflineState = !isConnected;
  lastCheckTime = now;
  
  console.log('Connectivity check result:', isConnected ? 'online' : 'offline');
  return isConnected;
};

/**
 * Get the current cached offline state without making a network request
 * Useful for quick synchronous checks
 * @returns {boolean} - True if cached as offline
 */
export const getCachedOfflineState = () => {
  return cachedOfflineState;
};

/**
 * Set up event listeners for browser online/offline events
 * This provides real-time updates when the connection status changes
 * @param {Function} onOnline - Callback when browser goes online
 * @param {Function} onOffline - Callback when browser goes offline
 * @returns {Function} - Cleanup function to remove event listeners
 */
export const setupNetworkListeners = (onOnline, onOffline) => {
  const handleOnline = async () => {
    console.log('Browser online event detected');
    // Verify with actual connectivity check
    const isConnected = await checkOnlineStatus();
    if (isConnected && onOnline) {
      onOnline();
    }
  };

  const handleOffline = () => {
    console.log('Browser offline event detected');
    cachedOfflineState = true;
    lastCheckTime = Date.now();
    if (onOffline) {
      onOffline();
    }
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Return cleanup function
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
};

/**
 * Initialize the network detection system
 * Sets up event listeners and performs initial connectivity check
 * @returns {Function} - Cleanup function
 */
export const initNetworkDetection = async () => {
  // Perform initial connectivity check
  await checkOnlineStatus();
  
  // Set up event listeners
  return setupNetworkListeners(
    () => console.log('Network: Connection restored'),
    () => console.log('Network: Connection lost')
  );
};

export default {
  checkOnlineStatus,
  getCachedOfflineState,
  setupNetworkListeners,
  initNetworkDetection
};
