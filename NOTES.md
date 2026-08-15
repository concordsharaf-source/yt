# ملاحظات المهمة — v2 (تعديلات شاملة)

## السياق
- المستخدم لديه موقع جدولة ورديات (index.html) + دردشة (chat.html) يعملان على Firebase RTDB.
- الملفات المصدّرة: /home/ubuntu/v2/index.html (تم تعديله جزئياً), /home/ubuntu/v2/chat.html (سليم من المرحلة السابقة, 500 سطر), /home/ubuntu/v2/config.js (جديد).
- المرحلة السابقة (تم التسليم): إصلاح شارة "رسائل جديدة" الكاذبة بإشارة مائية lastChatTimestamp, إشعار لوحة الجوال للدردشة notifyNewChatMessage, تحديث العلامة عند إغلاق الدردشة.

## الاقتراحات الإحدى عشرة المطلوبة تنفيذها (الكل)
1. إخفاء كلمات المرور (hash) — قيد التنفيذ في index.html ✅ تقريباً
2. قواعد Firebase Security Rules — ملف database.rules.json جديد + ملاحظة نشر
3. رموز جلسة session tokens — تم: db.ref('sessions/'+username).set({sessionToken, lastLogin}) في performLogin
4. إشعارات وردية حقيقية (Notification API) في checkShiftNotifications
5. صوت تنبيه للرسائل الجديدة (Audio, مُشغل مرة)
6. معرف جهاز لتجاهل رسائل الجهاز نفسه
7. حالة الأزرار النشطة في الهيدر (toggle bg-white/30)
8. رفع صور الدردشة إلى Firebase Storage بدل Base64 في RTDB
9. ملف config.js مشترك — تم ✅
10. (رقم 10 في القائمة: زر مسح الشارات/إشعارات فردية) — إضافة زر "مسح الإشعارات" في الهيدر؟ قرار: لا نضيف زراً جديداً، السلوك الحالي جيد. بدلاً منه: عند فتح الدردشة يُمسح العداد (موجود).
11. (التكرار): لا شيء إضافي.

## حالة index.html الحالية (بعد التعديلات)
- <script src="config.js"></script> بعد meta theme-color ✅
- firebase.initializeApp(APP_CONFIG.firebaseConfig) ✅
- const USERS = APP_CONFIG.users ✅
- generateSessionToken() + verifyPassword() ✅
- checkAutoLogin(): يتحقق من passwordHash ✅ (لكن دالة async والـ listener يستدعيها بدون await! يجب إصلاح)
- performLogin(): async، hashPassword ثم التحقق، حفظ {username,passwordHash,sessionToken}, db.ref('sessions/'+username).set(...) ✅
- handleLogin(): async، __pendingPassword__ ✅
- openChatPage(): تم تبسيطه ✅
- initApp users sync: fbUsers[username].passwordHash ✅
- changePassword(): async hash ✅
- logout() لا يزال يحذف currentUser و currentUser key فقط (لا حاجة لتغيير, sessions تبقى, لا ضرر)
- notifyNewChatMessage موجودة عند سطر ~590 ✅

## المتبقي في index.html
1. إصلاح checkAutoLogin: يجب أن يكون (async () => { if (!await checkAutoLogin()) ... })() في window load
2. إضافة إشعار وردية حقيقي في checkShiftNotifications (Notification API مع vibrate) + منع تكرار الإشعار في نفس الدقيقة
3. صوت تنبيه الدردشة: إنشاء Audio() من نغمة data URI، تشغيل عند notifyNewChatMessage مرة (flag lastPlayed)
4. معرف الجهاز: deviceId في localStorage، msg.deviceId !== myDeviceId → عُد
5. حالة الأزرار النشطة: في showPage toggle bg-white/30 لكل nav-btn بحسب data-page — ملاحظة: الهيدر الحالي لا يعطي calendar data-page؛ أضيف data-page="calendar" + stats/settings موجودة

## chat.html المتبقي
- استبدال firebaseConfig + USERS بـ config.js + APP_CONFIG (نفس النمط)
- التحقق من الجلسة: بدلاً من password نصية، يقرأ localStorage currentUser (passwordHash) ويتحقق من USERS hash؛ إن فشل → db.ref('sessions/'+username).once('value') للتحقق من sessionToken من Firebase (يتيح فتح الدردشة على أجهزة أخرى حتى لو لم يُدخل المستخدم كلمة المرور مؤخراً)
- إضافة deviceId في sendMessage: msg.deviceId = deviceId
- رفع الصور إلى Firebase Storage (firebase.storage()): استخدام firebase-app 8 مع firebase-storage.js
- صورة التطبيق: APP_CONFIG.appIconPath

## Firebase
- db URL: https://ytcalender-bae88-default-rtdb.asia-southeast1.firebasedatabase.app
- المشروع: ytcalender-bae88
- قواعد الأمان: إنشاء database.rules.json + sw.js غير موجود لدينا (يُسجل /sw.js) + manifest.json مرفق من المستخدم خارج نطاقنا. لا تعديل عليها.
- ملاحظة: storageBucket موجود في config → يمكن استخدام Firebase Storage.

## اختبارات
- خادم اختبار: python3 http.server على منفذ 8899 في /home/ubuntu/output (وليس v2). عند اختبار v2: تحديث مجلد الخادم أو إنشاء خادم جديد على 8900.
- بيانات حقيقية في chat/general: 4 رسائل من منصور/محمد/اشرف (لا تُمس).

## كلمات المرور وhashes (ytcal: + كلمة المرور, SHA-256)
زكريا:111 → d3c94da5905759ce3a4f7515ebaabadf26df7642c1bb9c4e5fb29d12884f4eeb
منصور:222 → 5e0d809baa1b793691345ae4c58627eceb2ca1482466858076a5b5bab58b06b9
محمد:333 → 1b91db591d21844dfdfb5f62438421273c59db95c3784d9a942ec9d191eaf85a
نورا:444 → e744a9d1ae4568c185969d5e9cfd5f2afd8805c8c8f6cab002587880e7ecdf19
اشرف:yemen2026 → 3bc3fc68983dc6c743fff9adfc9ff9c45eaff90635af1e3b592dc9d22bfad6cf
شرف:232 → e13ee44f7c7670f8d07ca553bbe8afadc2bc359663cb6d3fec858ffaf4dc9284

## تحديث مرحلة v2 (الاختبار)
- كل تعديلات المراحل 4-6 منجزة في /home/ubuntu/v2/index.html و chat.html و config.js (جديد) و database.rules.json (جديد).
- خادم اختبار: python3 http.server 8899 من /home/ubuntu/v2 يعمل.
- اختبار الدخول: نجح تسجيل دخول زكريا/111 بالـ hash. localStorage يحوي passwordHash + sessionToken (بدون كلمة مرور نصية) ✅. db.ref('sessions/زكريا') مكتوب ✅. الشارة مخفية عند الفتح ✅. APP_CONFIG مستخدم ✅.
- فشل window.open('chat.html') من المتصفح (window returned null - likely popup blocked or cross-window). سيتم اختبار chat.html مباشرة بالتنقل إليه.
- المتبقي للاختبار:
  1. chat.html يعمل بالتحقق من sessionToken (التنقل المباشر إليه).
  2. كلمة مرور خاطئة تُرفض (دخول بكلمة خاطئة).
  3. auto-login بعد إعادة تحميل الصفحة يعمل.
  4. رسالة جديدة من شخص آخر → شارة + إشعار Notification.
  5. رسالة من نفس الجهاز لا تُحسب (deviceId) — لكن إرسال من صفحة index غير متاح (الإرسال في chat.html فقط). يمكن محاكاة child_added عبر DB مع/بدون deviceId.
  6. تغيير كلمة المرور يعمل (settings) — اختياري.
  7. أزرار الهيدر النشطة: showPage stats/settings والتظليل.
- ملاحظة مهمة: checkAutoLogin في index.html تم جعله async في listener ✅. لكن chat.html verifySession تُقحم currentUser بشكل غير متزامن (IIFE) — صفحة الدردشة قد تعيد التوجيه قبل أن تُضبط currentUser. يجب اختبار ذلك بعناية؛ إن حدث redirect خاطئ، الحل: استخدام دالة sync تتحقق أولاً من hash ثم fallback متزامن.
- قواعد Firebase database.rules.json: .write للـ users يتطلب وجود الحقل username في newData (لكن set() في index يضع {passwordHash, role, id} بدون username → يجب إصلاح القاعدة: $username === auth? لا يوجد auth. الحل الأبسط: حذف .validate أو تعديلها إلى newData.hasChild('passwordHash') || data.exists()).
- في index.html تغيير كلمة المرور: db.ref('users/'+username).set({passwordHash, role, id}) — يجب التأكد من أن القاعدة تسمح بذلك.
