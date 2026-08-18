// ===== ملف الإعدادات المشترك =====
// أي تعديل على كلمات المرور أو إعدادات Firebase يتم هنا مرة واحدة فقط
// كلمات المرور هنا مخزنة كـ Hash (SHA-256) وليست نصاً صريحاً
// لإصدار Hash لكلمة مرور جديدة: حاسب SHA-256 للنص "ytcal:" + كلمة المرور

const APP_CONFIG = {
  firebaseConfig: {
    apiKey: "AIzaSyCHd1yY27vSskKuvvNZ_XmtwgoHc3lPe5k",
    authDomain: "ytcalender-bae88.firebaseapp.com",
    databaseURL: "https://ytcalender-bae88-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "ytcalender-bae88",
    storageBucket: "ytcalender-bae88.firebasestorage.app",
    messagingSenderId: "625139846676",
    appId: "1:625139846676:web:691be456f3f31e6572e101"
  },

  // hash = SHA-256("ytcal:" + كلمة المرور)
  users: {
    'زكريا': { passwordHash: 'd3c94da5905759ce3a4f7515ebaabadf26df7642c1bb9c4e5fb29d12884f4eeb', id: 1, role: 'employee' },
    'منصور': { passwordHash: '5e0d809baa1b793691345ae4c58627eceb2ca1482466858076a5b5bab58b06b9', id: 2, role: 'employee' },
    'محمد': { passwordHash: '1b91db591d21844dfdfb5f62438421273c59db95c3784d9a942ec9d191eaf85a', id: 3, role: 'employee' },
    'نورا':  { passwordHash: 'e744a9d1ae4568c185969d5e9cfd5f2afd8805c8c8f6cab002587880e7ecdf19', id: 4, role: 'employee' },
    'اشرف': { passwordHash: '3bc3fc68983dc6c743fff9adfc9ff9c45eaff90635af1e3b592dc9d22bfad6cf', id: 0, role: 'admin' },
    'شرف':  { passwordHash: 'e13ee44f7c7670f8d07ca553bbe8afadc2bc359663cb6d3fec858ffaf4dc9284', id: 5, role: 'admin' }
  },

  imageInputPath: 'images/',   // مسار مجلد الصور
  appIconPath: 'images/icon-192x192.png'
};

// ===== دالة مساعدة لحساب Hash كلمة المرور (تُستخدم عند تغييرها) =====
// يمكن استدعاؤها من أي صفحة: hashPassword('كلمة المرور الجديدة')
async function hashPassword(password) {
  const data = new TextEncoder().encode('ytcal:' + password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
