import api from '../utils/api';

const PUSH_WORKER_URL = '/push-worker.js';

/**
 * Service Worker registration and push notification handling
 */
class PushNotificationService {
  constructor() {
    this.registration = null;
    this.subscription = null;
    this.vapidPublicKey = null;
  }

  /**
   * Initialize the push notification service
   */
  async initialize() {
    try {
      // Check if push notifications are supported
      if (!('PushManager' in window)) {
        console.warn('Push notifications not supported');
        return false;
      }

      // Check if service workers are supported
      if (!('serviceWorker' in navigator)) {
        console.warn('Service workers not supported');
        return false;
      }

      // Get VAPID public key from server
      const response = await api.get('/notifications/vapid-key');
      if (response.data.success) {
        this.vapidPublicKey = response.data.publicKey;
      }

      // Register service worker
      this.registration = await navigator.serviceWorker.register(PUSH_WORKER_URL);
      console.log('Service Worker registered:', this.registration);

      // Check for existing subscription
      this.subscription = await this.registration.pushManager.getSubscription();
      
      return true;
    } catch (error) {
      console.error('Failed to initialize push notifications:', error);
      return false;
    }
  }

  /**
   * Check if user has permission for push notifications
   */
  getPermissionStatus() {
    if (!('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  }

  /**
   * Request permission for push notifications
   */
  async requestPermission() {
    if (!('Notification' in window)) {
      return 'unsupported';
    }

    const permission = await Notification.requestPermission();
    return permission;
  }

  async subscribe() {
    try {
      if (!this.registration) {
        await this.initialize();
      }

      // 1. Check for and clear any existing/stale subscriptions
      const existingSubscription = await this.registration.pushManager.getSubscription();
      if (existingSubscription) {
        await existingSubscription.unsubscribe();
      }

      if (!this.vapidPublicKey) {
        // Get VAPID public key from server
        const response = await api.get('/notifications/vapid-key');
        if (response.data.success && response.data.publicKey) {
          this.vapidPublicKey = response.data.publicKey;
        } else {
          throw new Error('Failed to get VAPID key from server');
        }
      }

      // Convert VAPID key to UInt8Array
      const vapidKey = this.urlBase64ToUint8Array(this.vapidPublicKey);

      // Subscribe to push notifications
      this.subscription = await this.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey
      });

      // Send subscription to server
      const response = await api.post('/notifications/subscribe', {
        subscription: this.subscription
      });

      if (response.data.success) {
        console.log('Push notification subscription successful');
        return { success: true, subscriptionId: response.data.subscriptionId };
      } else {
        // Clean up local subscription if server fails
        await this.subscription.unsubscribe();
        this.subscription = null;
        throw new Error(response.data.message || 'Failed to subscribe on server');
      }
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Unsubscribe from push notifications
   */
  async unsubscribe() {
    try {
      if (this.subscription) {
        // Remove from server
        await api.delete('/notifications/subscribe', {
          data: { endpoint: this.subscription.endpoint }
        });

        // Unsubscribe locally
        await this.subscription.unsubscribe();
        this.subscription = null;
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to unsubscribe from push notifications:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user's push notification preferences
   */
  async getPreferences() {
    try {
      const response = await api.get('/notifications/push-preferences');
      return response.data;
    } catch (error) {
      console.error('Failed to get preferences:', error);
      return { success: false, preferences: null };
    }
  }

  /**
   * Update push notification preferences
   */
  async updatePreferences(preferences) {
    try {
      const response = await api.put('/notifications/push-preferences', preferences);
      return response.data;
    } catch (error) {
      console.error('Failed to update preferences:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get push notification subscriptions
   */
  async getSubscriptions() {
    try {
      const response = await api.get('/notifications/subscriptions');
      return response.data;
    } catch (error) {
      console.error('Failed to get subscriptions:', error);
      return { success: false, subscriptions: [] };
    }
  }

  /**
   * Send test push notification
   */
  async sendTestNotification() {
    try {
      const response = await api.post('/notifications/push-test');
      return response.data;
    } catch (error) {
      console.error('Failed to send test notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get push notification history
   */
  async getHistory(limit = 50, offset = 0) {
    try {
      const response = await api.get('/notifications/push-history', {
        params: { limit, offset }
      });
      return response.data;
    } catch (error) {
      console.error('Failed to get history:', error);
      return { success: false, history: [] };
    }
  }

  /**
   * Convert URL-safe base64 to Uint8Array
   */
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

// Export singleton instance
const pushNotificationService = new PushNotificationService();

export default pushNotificationService;

// Export class for testing
export { PushNotificationService };
