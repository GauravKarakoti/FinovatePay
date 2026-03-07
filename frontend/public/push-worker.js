// Push Notification Service Worker
// This file handles incoming push notifications

const CACHE_NAME = 'finovatepay-v1';

// Handle push events
self.addEventListener('push', (event) => {
  console.log('[Push Worker] Push event received:', event);

  let data = {
    title: 'FinovatePay',
    body: 'You have a new notification',
    icon: '/icon.png',
    badge: '/badge.png',
    tag: 'default',
    data: {}
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      console.error('[Push Worker] Error parsing push data:', e);
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon.png',
    badge: data.badge || '/badge.png',
    tag: data.tag || 'default',
    data: data.data || {},
    vibrate: [100, 50, 100],
    actions: data.actions || [],
    requireInteraction: false,
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification click events
self.addEventListener('notificationclick', (event) => {
  console.log('[Push Worker] Notification click:', event);

  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action || 'default';

  // Handle different notification actions
  if (action === 'view' || action === 'default') {
    // Open the app and navigate to the relevant page
    const urlToOpen = data.url || '/';
    
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Check if there's already a window open
          for (const client of clientList) {
            if (client.url.includes(self.location.origin) && 'focus' in client) {
              client.focus();
              if (client.navigate) {
                return client.navigate(urlToOpen);
              }
              return client;
            }
          }
          // If no window is open, open a new one
          if (clients.openWindow) {
            return clients.openWindow(urlToOpen);
          }
        })
        .catch((error) => {
          console.error('[Push Worker] Error handling notification click:', error);
        })
    );
  } else if (action === 'bid') {
    // Handle bid action - navigate to auction
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          const urlToOpen = data.auctionUrl || '/auctions';
          
          for (const client of clientList) {
            if (client.url.includes(self.location.origin) && 'focus' in client) {
              client.focus();
              if (client.navigate) {
                return client.navigate(urlToOpen);
              }
              return client;
            }
          }
          if (clients.openWindow) {
            return clients.openWindow(urlToOpen);
          }
        })
    );
  }

  // Send analytics event
  sendAnalyticsEvent(data.type, action);
});

// Handle notification close events
self.addEventListener('notificationclose', (event) => {
  console.log('[Push Worker] Notification closed:', event);
  
  const data = event.notification.data || {};
  
  // You can track notification dismissal here if needed
  if (data.type) {
    console.log(`[Push Worker] Notification dismissed: ${data.type}`);
  }
});

// Send analytics event to the server
async function sendAnalyticsEvent(notificationType, action) {
  if (!notificationType) return;

  try {
    // Get the client ID from storage
    const clients = await self.clients.matchAll();
    const client = clients[0];
    
    if (client) {
      // Post message to the client to handle analytics
      client.postMessage({
        type: 'NOTIFICATION_CLICKED',
        notificationType,
        action
      });
    }
  } catch (error) {
    console.error('[Push Worker] Error sending analytics:', error);
  }
}

// Handle messages from the main app
self.addEventListener('message', (event) => {
  console.log('[Push Worker] Message received:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Handle activate event
self.addEventListener('activate', (event) => {
  console.log('[Push Worker] Activated:', event);
  
  // Claim any pending clients
  event.waitUntil(
    clients.claim()
      .then(() => {
        console.log('[Push Worker] Clients claimed successfully');
      })
      .catch((error) => {
        console.error('[Push Worker] Error claiming clients:', error);
      })
  );
});

// Handle install event
self.addEventListener('install', (event) => {
  console.log('[Push Worker] Installing:', event);
  
  // Precache static assets
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Push Worker] Caching static assets');
        return cache.addAll([
          '/',
          '/icon.png',
          '/badge.png'
        ]);
      })
      .catch((error) => {
        console.error('[Push Worker] Error caching:', error);
      })
  );
});

console.log('[Push Worker] Service Worker loaded');
