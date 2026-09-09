// ===== Service Worker - أوفلاين + إشعارات الخلفية (حتى والتطبيق نايم) =====
const CACHE_NAME = 'yt-calendar-offline-v7';
const ICON = './images/icon-192x192.png';
const APP_URL = './index.html';
const CHAT_URL = './chat.html';
const APP_SHELL = [
  './',
  './index.html',
  './chat.html',
  './config.js',
  './push.js',
  './tw.css',
  './fonts.css',
  './firebase-app.js',
  './firebase-database.js',
  './firebase-storage.js',
  './manifest.json',
  './images/icon-192x192.png',
  './images/icon-512x512.png',
  './image/1.jpg',
  './image/2.jpg',
  './image/3.jpg',
  './image/4.jpg',
  './fonts/tajawal-400.ttf',
  './fonts/tajawal-500.ttf',
  './fonts/tajawal-700.ttf',
  './fonts/tajawal-800.ttf'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(APP_SHELL); })
      .catch(function(error) { console.warn('Offline cache install failed:', error); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(key) {
        return key !== CACHE_NAME;
      }).map(function(key) { return caches.delete(key); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function(cached) {
      const networkRequest = fetch(event.request).then(function(response) {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, copy);
          });
        }
        return response;
      }).catch(function() { return cached; });
      return cached || networkRequest;
    }).catch(function() {
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html', { ignoreSearch: true });
      }
      return caches.match(event.request, { ignoreSearch: true });
    })
  );
});

self.addEventListener('message', function(event) {
  const data = event.data || {};
  if (data.type === 'notify' && data.title) {
    event.waitUntil(showNotification(data.title, data.body, data.tag, data.icon, data.url));
  }
});

self.addEventListener('push', function(event) {
  event.waitUntil((async function() {
    let data = {};
    try {
      if (event.data) {
        data = event.data.json();
      }
    } catch (e) {
      try { data = { body: event.data.text() }; } catch (e2) {}
    }
    const title = data.title || '💬 رسالة جديدة';
    const body = data.body || 'لديك إشعار جديد من جدول الورديات';
    const tag = data.tag || ('push-' + Date.now());
    await showNotification(title, body, tag, data.icon, data.url || (tag.indexOf('chat') >= 0 ? CHAT_URL : APP_URL));
  })());
});

self.addEventListener('periodicsync', function(event) {
  if (event.tag === 'ytcal-keep-alive' || event.tag === 'check-chat') {
    event.waitUntil(self.registration.update());
  }
});

self.addEventListener('pushsubscriptionchange', function(event) {
  event.waitUntil(self.registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array('BCwq5BUWwBl8-WURfqPPKXDMaYX3yh8uoDa9867xRMlK6XR5QnV6rc4HI1JhQVIAQADkSs9L6Xk7IKungVfH0qo')
  }));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || APP_URL;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      for (let i = 0; i < clients.length; i++) {
        const c = clients[i];
        if (c.url && 'focus' in c) {
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function showNotification(title, body, tag, icon, url) {
  const opts = {
    body: body || '',
    icon: icon || ICON,
    badge: ICON,
    tag: tag || 'ytcal-notification',
    silent: false,
    requireInteraction: true,
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    data: { url: url || APP_URL },
    actions: [{ action: 'open', title: 'فتح' }]
  };
  return self.registration.showNotification(title, opts);
}
