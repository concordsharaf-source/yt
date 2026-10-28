// ===== Web Push عبر Supabase Edge Function =====
// الاشتراك يُحفظ في Supabase، والإرسال يتم من الخادم (المفتاح الخاص VAPID هناك فقط).
// الواجهة العامة تبقى كما هي: subscribeAndSave / notifyUser / notifyAllDevices / getDeviceId
(function (root) {
  // مهم: config.js يعرّف "const APP_CONFIG" — يظهر كمعرّف عام مجرّد لكنه ليس خاصية على window.
  // لذلك نقرنه بالاسم المجرّد عبر فحص النوع، ولا نستخدم window.APP_CONFIG.
  const CFG = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.supabasePush) || {};
  const FUNCTION_URL = CFG.functionUrl || 'https://pyjjaekcqbdijcyloqvx.supabase.co/functions/v1/send-push';
  const APP_KEY = CFG.appKey || '';
  const VAPID_PUBLIC = CFG.vapidPublicKey || '';
  const VAPID_STORAGE_KEY = 'yt_vapid_public';
  const LAST_REGISTER_KEY = 'yt_push_last_register';
  const SW_RELOAD_KEY = 'yt_sw_reloaded';
  const RE_REGISTER_INTERVAL = 12 * 60 * 60 * 1000; // 12 ساعة: تجديد الاشتراكات التي قد تموت

  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64url(bytes) {
    const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    let s = '';
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function getDeviceId() {
    let id = localStorage.getItem('deviceId');
    if (!id) {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      id = Array.from(arr).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      localStorage.setItem('deviceId', id);
    }
    return id;
  }

  async function callFunction(bodyObj) {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-key': APP_KEY },
      body: JSON.stringify(bodyObj)
    });
    if (!res.ok) {
      const text = await res.text().catch(function () { return ''; });
      throw new Error('send-push HTTP ' + res.status + ' ' + text);
    }
    return res.json().catch(function () { return {}; });
  }

  // المفتاح الذي أُنشئ به الاشتراك الحالي (لإعادة الاشتراك عند تدوير مفتاح VAPID)
  async function subscriptionMatchesKey(sub) {
    try {
      const buf = sub.options && sub.options.applicationServerKey;
      if (!buf) return true; // المتصفحات القديمة لا تكشف المفتاح
      return bytesToB64url(buf) === VAPID_PUBLIC;
    } catch (e) { return true; }
  }

  async function subscribeAndSave(db, username) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    if (!('Notification' in window)) return null;
    if (!VAPID_PUBLIC || !APP_KEY) {
      console.warn('YTPush: إعدادات Supabase غير متوفرة في APP_CONFIG.supabasePush');
      return null;
    }
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return null;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    // ترحيل موثوق عبر كل المتصفحات: إذا تغيّر مفتاح VAPID (أو أول مرة بعد الترقية)
    // نلغي الاشتراك القديم وننشئ واحداً جديداً مطابقاً للمفتاح الحالي.
    const storedVapid = localStorage.getItem(VAPID_STORAGE_KEY);
    const keyChanged = storedVapid !== VAPID_PUBLIC;
    if (sub && (keyChanged || !(await subscriptionMatchesKey(sub)))) {
      await sub.unsubscribe().catch(function () {});
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToBytes(VAPID_PUBLIC)
      });
    }
    const json = sub.toJSON();
    const deviceId = getDeviceId();

    // المصدر الأساسي: Supabase عبر الدالة
    let registered = false;
    try {
      await callFunction({
        action: 'register',
        app_user: username || null,
        device_id: deviceId,
        subscription: {
          endpoint: json.endpoint,
          keys: json.keys,
          expirationTime: json.expirationTime || null
        }
      });
      registered = true;
      // تأكيد أن هذا الجهاز مربوط بمفتاح VAPID الحالي (يمنع إعادة الاشتراك كل مرة)
      localStorage.setItem(VAPID_STORAGE_KEY, VAPID_PUBLIC);
    } catch (e) {
      console.warn('YTPush: تعذر التسجيل في Supabase:', e);
      // احتياط: احفظ في Firebase عند تعذر الوصول لـ Supabase فقط
      if (db && username) {
        db.ref('pushSubscriptions/' + username + '/' + deviceId).set({
          endpoint: json.endpoint,
          keys: json.keys,
          expirationTime: json.expirationTime || null,
          updatedAt: Date.now()
        }).catch(function () {});
      }
    }
    json.registered = registered;
    return json;
  }

  async function notifyUser(db, username, payload, exceptDeviceId) {
    if (!username) return;
    return callFunction({
      action: 'send',
      app_users: [username],
      payload: payload,
      except_device_id: exceptDeviceId || null
    }).catch(function (e) { console.warn('notifyUser failed:', e); });
  }

  async function notifyAllDevices(db, payload, exceptDeviceId) {
    return callFunction({
      action: 'send',
      notify_all: true,
      payload: payload,
      except_device_id: exceptDeviceId || null
    }).catch(function (e) { console.warn('notifyAllDevices failed:', e); });
  }

  // يزامن جدول الورديات المحسوب (التناوب + التعيينات اليدوية) إلى Supabase
  // لاستخدامه في تنبيهات الكرون التي تصل والتطبيق مغلق.
  async function syncSchedule(entries) {
    if (!entries || !entries.length) return { ok: true, synced: 0 };
    return callFunction({ action: 'sync_shifts', shifts: entries });
  }

  async function unsubscribeCurrent() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await callFunction({ action: 'unregister', endpoint: sub.endpoint }).catch(function () {});
        await sub.unsubscribe().catch(function () {});
      }
      return true;
    } catch (e) { return false; }
  }

  // ===== تجديد تلقائي للاشتراك =====
  // الهدف: ألا يضطر أي مستخدم لمسح بيانات المتصفح أو إعادة تثبيت التطبيق،
  // حتى بعد تدوير مفتاح VAPID أو تحديث عامل الخدمة أو موت الاشتراك عند FCM.
  function currentUsername() {
    try {
      const raw = localStorage.getItem('currentUser');
      if (!raw) return null;
      const u = JSON.parse(raw);
      return (u && u.username) || null;
    } catch (e) { return null; }
  }

  // force=true يتجاهل فترة الـ 12 ساعة (تستخدمه صفحة الفحص والزر اليدوي)
  async function ensureSubscription(force) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return null;
    const username = currentUsername();
    if (!username) return null;
    const last = Number(localStorage.getItem(LAST_REGISTER_KEY) || 0);
    const keyChanged = localStorage.getItem(VAPID_STORAGE_KEY) !== VAPID_PUBLIC;
    const due = (Date.now() - last) > RE_REGISTER_INTERVAL;
    if (!force && !due && !keyChanged) return { skipped: true };
    try {
      const res = await subscribeAndSave(null, username);
      if (res && res.registered !== false) {
        localStorage.setItem(LAST_REGISTER_KEY, String(Date.now()));
      }
      return res;
    } catch (e) {
      console.warn('YTPush: فشل تجديد الاشتراك:', e);
      return null;
    }
  }

  if (typeof document !== 'undefined') {
    const runEnsure = function () { setTimeout(function () { ensureSubscription(false); }, 1200); };
    if (document.readyState === 'complete' || document.readyState === 'interactive') runEnsure();
    else document.addEventListener('DOMContentLoaded', runEnsure);

    // عند عودة المستخدم للتطبيق من الخلفية (مهم على الجوال)
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) ensureSubscription(false);
    });
    window.addEventListener('focus', function () { ensureSubscription(false); });

    // تحديث الصفحة مرة واحدة فقط عند تفعيل عامل خدمة جديد،
    // حتى تُحمّل النسخة الجديدة من config.js/push.js فوراً دون تدخل المستخدم.
    if ('serviceWorker' in navigator) {
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (reloading) return;
        try { if (sessionStorage.getItem(SW_RELOAD_KEY)) return; } catch (e) { /* خصوصية */ }
        reloading = true;
        try { sessionStorage.setItem(SW_RELOAD_KEY, '1'); } catch (e) { /* خصوصية */ }
        window.location.reload();
      });
    }
  }

  root.YTPush = {
    subscribeAndSave: subscribeAndSave,
    notifyUser: notifyUser,
    notifyAllDevices: notifyAllDevices,
    syncSchedule: syncSchedule,
    unsubscribeCurrent: unsubscribeCurrent,
    getDeviceId: getDeviceId,
    ensureSubscription: ensureSubscription
  };
})(window);
