// اسم ذاكرة التخزين المؤقت (غيّر الرقم عند كل تحديث)
const CACHE_NAME = 'my-site-cache-v2';

// القائمة الأساسية (الضرورية فقط للتثبيت)
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// حدث التثبيت
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('جاري تثبيت الملفات الأساسية');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // تفعيل السيرفس ووركر فوراً
  );
});

// حدث الجلب: استراتيجية ذكية للملفات
self.addEventListener('fetch', (event) => {
  // نتجاهل طلبات POST أو الطلبات لمواقع خارجية
  if (event.request.method !== 'GET') return;
  
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // إذا الملف موجود في الكاش، قدمه فوراً
        if (cachedResponse) {
          return cachedResponse;
        }

        // إذا مش موجود، حاول تحميله من النت
        return fetch(event.request)
          .then((response) => {
            // لو الطلب ناجح، خزنه للمرات الجاية
            if (response && response.status === 200) {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, responseToCache);
                });
            }
            return response;
          })
          .catch(() => {
            // لو النت مقطوع والملف مش موجود
            // للملفات HTML فقط، أرجع الصفحة الرئيسية المخزنة
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/');
            }
            // للصور والملفات التانية، لا ترجع شيء
            return new Response('');
          });
      })
  );
});

// حدث التفعيل: تنظيف الكاش القديم
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('جاري حذف الكاش القديم:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim(); // سيطرة فورية على كل الصفحات
});