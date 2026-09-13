# خادم الإشعارات (Supabase Edge Function)

هذا المجلد يوثّق جزء الخادم لنظام الإشعارات الذي يستبدل آلية الإرسال القديمة
(كان المفتاح الخاص VAPID مكشوفاً في `push.js` مع مرحّل `push-relay.php`).

## المعمارية

```
الصفحة (push.js)
   │  تسجيل جهاز / طلب إرسال  (ترويسة x-app-key)
   ▼
Edge Function send-push  (npm: web-push، توقيع VAPID على الخادم فقط)
   │
   ▼
جدول push_subscriptions (Postgres + RLS)
   │
   ▼
خوادم Web Push (FCM/Mozilla) → Service Worker (sw.js) يعرض الإشعار
```

- `functions/send-push/index.ts` — الدالة (تسجيل/إلغاء/إرسال لمستخدم أو للجميع).
- `migrations/` — مخطط جدول الاشتراكات.

## الأسرار المطلوبة في Supabase (Dashboard → Edge Functions → Secrets)

| السر | الوصف |
|---|---|
| `VAPID_PUBLIC_KEY` | مفتاح VAPID العام (موجود أيضاً في `config.js`) |
| `VAPID_PRIVATE_KEY` | مفتاح VAPID الخاص — **لا يُكتب في الكود إطلاقاً** |
| `VAPID_SUBJECT` | مثل `mailto:admin@example.com` |
| `APP_PUSH_KEY` | مفتاح يرسله العميل في ترويسة `x-app-key` |
| `WEBHOOK_SECRET` | يُستخدم فقط عند استدعاء الدالة من تريغر قاعدة البيانات |

## النشر

```bash
npm i -g supabase
supabase link --project-ref pyjjaekcqbdijcyloqvx
supabase secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." \
  VAPID_SUBJECT="mailto:..." APP_PUSH_KEY="..." WEBHOOK_SECRET="..."
supabase functions deploy send-push
```

## واجهة الدالة (POST /functions/v1/send-push)

```jsonc
// تسجيل
{ "action": "register", "app_user": "زكريا", "device_id": "...",
  "subscription": { "endpoint": "https://...", "keys": { "p256dh": "...", "auth": "..." } } }

// إلغاء
{ "action": "unregister", "endpoint": "https://..." }

// إرسال لمستخدم (اسمه كما في config.js)
{ "app_user": "اشرف",
  "payload": { "title": "🔄 طلب تبديل", "body": "...", "tag": "swap-1", "url": "./index.html" } }

// إرسال للجميع (الدردشة الجماعية)
{ "notify_all": true, "except_device_id": "جهاز المرسِل اختيارياً",
  "payload": { "title": "💬 رسالة جديدة", "body": "...", "tag": "c1", "url": "./chat.html" } }
```

> ملاحظة: `app_user` هو اسم الموظف كما في `APP_CONFIG.users`.
> الدالة تحذف الاشتراكات المنتهية تلقائياً (استجابات 404/410).
