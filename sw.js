// اسم ذاكرة التخزين المؤقت (يمكنك تغييره عند تحديث ملفات موقعك مستقبلاً)
const CACHE_NAME = 'my-site-cache-v1';

// قائمة بالملفات التي نريد حفظها لتعمل بدون إنترنت
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/images/icon-192x192.png',
  '/images/icon-512x512.png'
  // ملاحظة: إذا كان لديك ملفات CSS أو جافا سكربت أخرى، أضف مساراتها هنا
];

// حدث التثبيت: نقوم بفتح الذاكرة وحفظ الملفات بداخلها
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('تم فتح ذاكرة التخزين المؤقت وحفظ الملفات');
        return cache.addAll(urlsToCache);
      })
  );
});

// حدث الجلب (Fetch): عندما يطلب المتصفح ملفاً، نتحقق من الذاكرة أولاً
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // إذا وجدنا الملف محفوظاً في الذاكرة، نعرضه للمستخدم مباشرة (يعمل بدون نت)
        if (response) {
          return response;
        }
        // إذا لم يكن الملف في الذاكرة، نقوم بجلبه من الإنترنت بشكل طبيعي
        return fetch(event.request);
      })
  );
});

// حدث التفعيل: لحذف أي ذاكرة قديمة إذا قمنا بتغيير اسم CACHE_NAME أعلاه
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
