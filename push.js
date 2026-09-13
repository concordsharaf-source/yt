// ===== Web Push عبر Supabase Edge Function =====
// الاشتراك يُحفظ في Supabase، والإرسال يتم من الخادم (المفتاح الخاص VAPID هناك فقط).
// الواجهة العامة تبقى كما هي: subscribeAndSave / notifyUser / notifyAllDevices / getDeviceId
(function (root) {
  const CFG = (root.APP_CONFIG && APP_CONFIG.supabasePush) || {};
  const FUNCTION_URL = CFG.functionUrl || 'https://pyjjaekcqbdijcyloqvx.supabase.co/functions/v1/send-push';
  const APP_KEY = CFG.appKey || '';
  const VAPID_PUBLIC = CFG.vapidPublicKey || '';

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
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return null;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && !(await subscriptionMatchesKey(sub))) {
      // مفتاح VAPID تغيّر → اشتراك جديد
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
    } catch (e) {
      // احتياط: احفظ في Firebase عند تعذر الوصول لـ Supabase
      if (db && username) {
        db.ref('pushSubscriptions/' + username + '/' + deviceId).set({
          endpoint: json.endpoint,
          keys: json.keys,
          expirationTime: json.expirationTime || null,
          updatedAt: Date.now()
        }).catch(function () {});
      }
    }
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

  root.YTPush = {
    subscribeAndSave: subscribeAndSave,
    notifyUser: notifyUser,
    notifyAllDevices: notifyAllDevices,
    syncSchedule: syncSchedule,
    unsubscribeCurrent: unsubscribeCurrent,
    getDeviceId: getDeviceId
  };
})(window);
