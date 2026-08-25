// ===== Service Worker - وضع الأوفلاين والإشعارات =====
// يخزّن ملفات التطبيق محلياً، ثم يستخدمها عند عدم توفر الشبكة.
const CACHE_NAME = 'yt-calendar-offline-v5';
const ICON = './images/icon-192x192.png';
const APP_URL = './index.html';
const APP_SHELL = [
  './',
  './index.html',
  './chat.html',
  './config.js',
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

// استراتيجية cache-first للملفات المحلية، مع تحديث نسخة الكاش عند نجاح الشبكة.
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
      });
      return cached || networkRequest;
    }).catch(function() {
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html', { ignoreSearch: true });
      }
      return caches.match(event.request, { ignoreSearch: true });
    })
  );
});

// استقبال رسائل إشعار من صفحات التطبيق.
self.addEventListener('message', function(event) {
  const data = event.data || {};
  if (data.type === 'notify' && data.title) {
    showNotification(data.title, data.body, data.tag, data.icon);
  }
});

// استقبال دفعات الخلفية (تتطلب اشتراك Push).
self.addEventListener('push', function(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}
  if (data.title) {
    event.waitUntil(showNotification(data.title, data.body, data.tag, data.icon));
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function(clients) {
      if (clients.length > 0) {
        clients[0].focus();
        return;
      }
      return self.clients.openWindow(APP_URL);
    })
  );
});

function showNotification(title, body, tag, icon) {
  const opts = {
    body: body || '',
    icon: icon || ICON,
    badge: ICON,
    tag: tag || 'ytcal-notification',
    silent: false,
    requireInteraction: false,
    vibrate: [200, 100, 200]
  };
  if (tag) opts.renotify = true;
  return self.registration.showNotification(title, opts);
}
