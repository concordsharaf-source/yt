// ===== Web Push: اشتراك + إرسال حتى والتطبيق نايم =====
(function (root) {
  const VAPID_PUBLIC = 'BCwq5BUWwBl8-WURfqPPKXDMaYX3yh8uoDa9867xRMlK6XR5QnV6rc4HI1JhQVIAQADkSs9L6Xk7IKungVfH0qo';
  const VAPID_PRIVATE_JWK = {
    kty: 'EC',
    crv: 'P-256',
    x: 'LCrkFRbAGXz5ZRF-o88pcMxphffKHy6gNr3zrvFEyUo',
    y: '6XR5QnV6rc4HI1JhQVIAQADkSs9L6Xk7IKungVfH0qo',
    d: '2zDlreFvPmCORC1dbw7bvWYgJKCH5mRyVS4BMF_6aek'
  };
  const VAPID_SUBJECT = 'mailto:ytcal@yemen-today.local';

  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64url(bytes) {
    let s = '';
    const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function concat() {
    let n = 0;
    for (let i = 0; i < arguments.length; i++) n += arguments[i].length;
    const out = new Uint8Array(n);
    let o = 0;
    for (let i = 0; i < arguments.length; i++) {
      out.set(arguments[i], o);
      o += arguments[i].length;
    }
    return out;
  }
  function strBytes(str) {
    return new TextEncoder().encode(str);
  }

  async function importVapidKey() {
    return crypto.subtle.importKey('jwk', VAPID_PRIVATE_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  async function vapidJwt(audience) {
    const header = bytesToB64url(strBytes(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
    const payload = bytesToB64url(strBytes(JSON.stringify({ aud: audience, exp: exp, sub: VAPID_SUBJECT })));
    const unsigned = header + '.' + payload;
    const key = await importVapidKey();
    const sig = new Uint8Array(await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      strBytes(unsigned)
    ));
    return unsigned + '.' + bytesToB64url(sig);
  }

  async function hkdfExpand(prk, info, len) {
    const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const input = concat(info, new Uint8Array([1]));
    const out = new Uint8Array(await crypto.subtle.sign('HMAC', key, input));
    return out.slice(0, len);
  }
  async function hmacSha256(keyBytes, data) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  }

  async function encryptPayload(subscription, payloadStr) {
    const p256dh = b64urlToBytes(subscription.keys.p256dh);
    const auth = b64urlToBytes(subscription.keys.auth);
    const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const asPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
    const uaKey = await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdhBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256);
    const ecdhSecret = new Uint8Array(ecdhBits);

    const infoKey = concat(strBytes('WebPush: info\0'), p256dh, asPubRaw);
    const ikmPrk = await hmacSha256(auth, ecdhSecret);
    const ikm = await hkdfExpand(ikmPrk, infoKey, 32);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const prk = await hmacSha256(salt, ikm);
    const cek = await hkdfExpand(prk, strBytes('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdfExpand(prk, strBytes('Content-Encoding: nonce\0'), 12);

    const padded = concat(strBytes(payloadStr), new Uint8Array([2]));
    const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

    const rs = new Uint8Array([0, 0, 16, 0]);
    const idlen = new Uint8Array([asPubRaw.length]);
    return concat(salt, rs, idlen, asPubRaw, cipher);
  }

  async function sendToEndpoint(endpoint, bodyBytes, jwt) {
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Urgency: 'high',
      Authorization: 'vapid t=' + jwt + ', k=' + VAPID_PUBLIC
    };
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: headers, body: bodyBytes });
      if (res.ok || res.status === 201 || res.status === 202) return true;
    } catch (e) { /* CORS غالباً */ }
    try {
      const headerList = Object.keys(headers).map(function (k) { return k + ': ' + headers[k]; });
      const res = await fetch('./push-relay.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: endpoint,
          headers: headerList,
          body: bytesToB64url(bodyBytes)
        })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async function sendPushToSubscription(sub, payloadObj) {
    if (!sub || !sub.endpoint || !sub.keys) return false;
    const origin = new URL(sub.endpoint).origin;
    const jwt = await vapidJwt(origin);
    const body = await encryptPayload(sub, JSON.stringify(payloadObj));
    return sendToEndpoint(sub.endpoint, body, jwt);
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

  async function subscribeAndSave(db, username) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    if (!('Notification' in window)) return null;
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return null;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToBytes(VAPID_PUBLIC)
      });
    }
    const json = sub.toJSON();
    const deviceId = getDeviceId();
    if (db && username) {
      db.ref('pushSubscriptions/' + username + '/' + deviceId).set({
        endpoint: json.endpoint,
        keys: json.keys,
        expirationTime: json.expirationTime || null,
        updatedAt: Date.now()
      }).catch(function () {});
    }
    return json;
  }

  async function notifyAllDevices(db, payload, exceptDeviceId) {
    if (!db) return;
    const snap = await db.ref('pushSubscriptions').once('value');
    const all = snap.val() || {};
    const jobs = [];
    Object.keys(all).forEach(function (user) {
      const devices = all[user] || {};
      Object.keys(devices).forEach(function (devId) {
        if (exceptDeviceId && devId === exceptDeviceId) return;
        const sub = devices[devId];
        jobs.push(sendPushToSubscription(sub, payload).catch(function () {}));
      });
    });
    await Promise.all(jobs);
  }

  async function notifyUser(db, username, payload, exceptDeviceId) {
    if (!db || !username) return;
    const snap = await db.ref('pushSubscriptions/' + username).once('value');
    const devices = snap.val() || {};
    const jobs = [];
    Object.keys(devices).forEach(function (devId) {
      if (exceptDeviceId && devId === exceptDeviceId) return;
      jobs.push(sendPushToSubscription(devices[devId], payload).catch(function () {}));
    });
    await Promise.all(jobs);
  }

  root.YTPush = {
    subscribeAndSave: subscribeAndSave,
    notifyAllDevices: notifyAllDevices,
    notifyUser: notifyUser,
    getDeviceId: getDeviceId
  };
})(window);
