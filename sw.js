// ===== Service Worker - خدمة الإشعارات الخلفية =====
// يتيح للموقع إرسال إشعارات في لوحة إشعارات الهاتف حتى عند تشغيل الموقع في الخلفية.
// (إشعارات الويب لا تعمل عند إغلاق الموقع تماماً دون خادم Push - انظر دليل التحديث)

const ICON = 'images/icon-192x192.png';
const APP_URL = './';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

// استقبال رسائل إشعار من صفحات التطبيق (حتى الصفحات المغلقة داخل المتصفح)
self.addEventListener('message', function(event) {
  const data = event.data || {};
  if (data.type === 'notify' && data.title) {
    showNotification(data.title, data.body, data.tag, data.icon);
  }
});

// استقبال دفعات الخلفية (تتطلب اشتراك Push - خطوة مستقبلية، موجودة جاهزة)
self.addEventListener('push', function(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}
  if (data.title) {
    event.waitUntil(
      showNotification(data.title, data.body, data.tag, data.icon)
    );
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function(clients) {
      // فتح/تركيز نافذة التطبيق عند الضغط على الإشعار
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
  // إعادة الظهور حتى لو كان الإشعار السابق بنفس tag
  if (tag) opts.renotify = true;
  return self.registration.showNotification(title, opts);
}
