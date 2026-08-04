self.addEventListener('install', (event) => {
  console.log('تم تثبيت Service Worker بنجاح');
});

self.addEventListener('fetch', (event) => {
  // هنا تتم إدارة طلبات الشبكة (يمكنك لاحقاً إضافة أكواد التخزين المؤقت هنا)
});

