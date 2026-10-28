// =============================================================
// send-push — دالة موحّدة تخدم تطبيقين على نفس المشروع:
//   • yt  (جدول الورديات) : x-app-key     + إجراءات register/send/sync_shifts
//   • dion(دفتر الديون)   : x-push-secret + حمولة userId/title/body/kind
// النسخة الأصلية ل dion مدموجة كما هي في handleDion().
// =============================================================
import webpush from 'npm:web-push@3'
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'
import crypto from 'node:crypto'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-app-key, x-push-secret, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// مفاتيح dion (النسخة الأصلية) — لا تُغيّر
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:concordsharaf@gmail.com'
// مفاتيح yt الخاصة (زوج مستقل)، تُستخدم لكل طلبات yt فقط
const YT_VAPID_PUBLIC_KEY = Deno.env.get('YT_VAPID_PUBLIC_KEY') ?? ''
const YT_VAPID_PRIVATE_KEY = Deno.env.get('YT_VAPID_PRIVATE_KEY') ?? ''
const YT_VAPID_SUBJECT = Deno.env.get('YT_VAPID_SUBJECT') ?? 'mailto:concordsharaf@gmail.com'
const APP_PUSH_KEY = Deno.env.get('APP_PUSH_KEY') ?? ''
const PUSH_HOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET') ?? ''
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? ''

// المفتاح العام الذي يستخدمه تطبيق yt في config.js / sw.js
const YT_CONFIG_PUBLIC = 'BM9EBHzzcRkxzxUbwfJuR7A9Jcsi11Uc0GGi9YqX8dyzBqMRyJmZ9tCgzFSSYf2ffyBWnHwACd7t6VD7fuX5rI4'

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function b64urlToBuf(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

// يشتق المفتاح العام من الخاص (المفتاح العام ليس سراً) — للفحص فقط
function derivePublic(priv: string): string {
  const ecdh = crypto.createECDH('prime256v1')
  const raw = b64urlToBuf(priv)
  ecdh.setPrivateKey(raw)
  const pub = new Uint8Array(ecdh.getPublicKey())
  let bin = ''
  for (let i = 0; i < pub.length; i++) bin += String.fromCharCode(pub[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function setVapid(): void {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}
// yt يوقّع بزوج مختلف عن dion لتجنب تضارب الاشتراكات
function setYtVapid(): void {
  const pub = YT_VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY
  const priv = YT_VAPID_PRIVATE_KEY || VAPID_PRIVATE_KEY
  webpush.setVapidDetails(YT_VAPID_SUBJECT, pub, priv)
}

// ------------------ تشخيص (لا يُظهر أي سر) ------------------
async function handleDiag(admin: SupabaseClient) {
  let derived = ''
  try { derived = derivePublic(VAPID_PRIVATE_KEY) } catch (e) { derived = 'ERR:' + String(e) }
  const { count } = await admin.from('push_subscriptions').select('*', { count: 'exact', head: true })
  return json(200, {
    ok: true,
    vapid_public_from_env_sha256: await sha256hex(VAPID_PUBLIC_KEY),
    vapid_public_derived_from_private: derived,
    private_matches_env_public: derived === VAPID_PUBLIC_KEY,
    private_matches_yt_config: derived === YT_CONFIG_PUBLIC,
    env_public_matches_yt_config: VAPID_PUBLIC_KEY === YT_CONFIG_PUBLIC,
    yt_public_sha256: await sha256hex(YT_VAPID_PUBLIC_KEY),
    yt_private_matches_yt_public: (() => { try { return derivePublic(YT_VAPID_PRIVATE_KEY) === YT_VAPID_PUBLIC_KEY } catch { return false } })(),
    yt_public_len: YT_VAPID_PUBLIC_KEY.length,
    vapid_public_len: VAPID_PUBLIC_KEY.length,
    vapid_private_len: VAPID_PRIVATE_KEY.length,
    app_push_key_set: !!APP_PUSH_KEY,
    push_hook_secret_set: !!PUSH_HOOK_SECRET,
    webhook_secret_set: !!WEBHOOK_SECRET,
    subscription_rows: count,
  })
}

// ------------------ yt: التسجيل / الإلغاء ------------------
async function ytRegister(admin: SupabaseClient, p: any) {
  const sub = p?.subscription
  const appUser: string | null = p?.app_user ? String(p.app_user) : null
  const deviceId: string | null = p?.device_id ? String(p.device_id) : null
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth)
    return json(400, { error: 'subscription.endpoint and keys are required' })
  if (deviceId) {
    await admin.from('push_subscriptions').delete().eq('device_id', deviceId).neq('endpoint', sub.endpoint)
  }
  // نكتب التمثيلين (keys JSONB لـ yt و p256dh/auth لـ dion) ليظل الجدول متوافقاً
  const { error } = await admin.from('push_subscriptions').upsert(
    {
      endpoint: sub.endpoint,
      keys: sub.keys,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      app_user: appUser,
      device_id: deviceId,
      user_id: p?.user_id ?? null,
      enabled: true,
      failed_count: 0,
    },
    { onConflict: 'endpoint' },
  )
  if (error) return json(500, { error: error.message })
  return json(200, { ok: true, registered: true })
}

async function ytUnregister(admin: SupabaseClient, p: any) {
  if (!p?.endpoint) return json(400, { error: 'endpoint required' })
  await admin.from('push_subscriptions').delete().eq('endpoint', p.endpoint)
  return json(200, { ok: true, unregistered: true })
}

async function ytSyncShifts(admin: SupabaseClient, p: any) {
  const rows = p?.shifts
  if (!Array.isArray(rows) || rows.length === 0) return json(400, { error: 'shifts[] required' })
  const clean = rows
    .filter((r: any) => r?.date_key && r?.shift_date)
    .map((r: any) => ({
      date_key: String(r.date_key),
      shift_date: String(r.shift_date),
      employee_id: r.employee_id != null ? Number(r.employee_id) : null,
      employee_name: r.employee_name ? String(r.employee_name) : null,
      day_week: r.day_week != null ? Number(r.day_week) : new Date(r.shift_date).getDay(),
      updated_at: new Date().toISOString(),
    }))
  if (!clean.length) return json(400, { error: 'no valid shifts' })
  const { error } = await admin.from('shift_schedule').upsert(clean, { onConflict: 'date_key' })
  if (error) return json(500, { error: error.message, hint: error.hint, sample: clean[0] })
  const cutoff = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)
  await admin.from('shift_schedule').delete().lt('shift_date', cutoff)
  return json(200, { ok: true, synced: clean.length })
}

async function ytResolveRecipients(admin: SupabaseClient, p: any) {
  let q = admin.from('push_subscriptions').select('endpoint, keys, p256dh, auth, app_user, device_id, user_id')
  if (p?.record) {
    if (p.record.receiver_id) q = q.eq('user_id', p.record.receiver_id)
    else return { rows: null, error: json(400, { error: 'record.receiver_id missing' }) }
  } else if (p?.notify_all) {
    // لا نُرسل إشعارات yt لأجهزة dion التي بلا app_user
    q = q.not('app_user', 'is', null)
  } else if (p?.app_users?.length || p?.app_user) {
    q = q.in('app_user', p.app_users ?? [p.app_user])
  } else if (p?.user_ids?.length || p?.user_id) {
    q = q.in('user_id', p.user_ids ?? [p.user_id])
  } else {
    return { rows: null, error: json(400, { error: 'No recipients specified' }) }
  }
  if (p?.except_device_id) q = q.neq('device_id', String(p.except_device_id))
  const { data, error } = await q
  if (error) return { rows: null, error: json(500, { error: error.message }) }
  return { rows: data, error: null }
}

function ytPayload(p: any): string {
  if (p?.payload && typeof p.payload === 'object') return JSON.stringify(p.payload)
  if (p?.record) {
    const r = p.record
    return JSON.stringify({
      title: r.title ?? 'رسالة جديدة 💬',
      body: r.content ?? r.body ?? 'لديك رسالة جديدة',
      tag: r.tag ?? `push-${Date.now()}`,
      url: r.conversation_id ? `/chat/${r.conversation_id}` : p.url ?? './chat.html',
    })
  }
  return JSON.stringify({
    title: p?.title ?? 'رسالة جديدة 💬',
    body: p?.body ?? 'لديك رسالة جديدة',
    tag: p?.tag ?? `push-${Date.now()}`,
    url: p?.url ?? p?.data?.url ?? './index.html',
    ...(p?.icon ? { icon: p.icon } : {}),
  })
}

async function ytSend(admin: SupabaseClient, p: any) {
  const { rows, error } = await ytResolveRecipients(admin, p)
  if (error) return error
  if (!rows || rows.length === 0) return json(200, { ok: true, sent: 0, removed: 0, note: 'No subscriptions found' })
  setYtVapid()
  const payload = ytPayload(p)
  let sent = 0, failed = 0, removed = 0
  const errors: string[] = []
  await Promise.all(rows.map(async (sub: any) => {
    try {
      const keys = (sub.keys && sub.keys.p256dh && sub.keys.auth)
        ? sub.keys
        : { p256dh: sub.p256dh, auth: sub.auth }
      await webpush.sendNotification({ endpoint: sub.endpoint, keys }, payload, { TTL: 86400 })
      sent++
      await admin.from('push_subscriptions')
        .update({ last_seen_at: new Date().toISOString(), failed_count: 0 })
        .eq('endpoint', sub.endpoint)
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        removed++
      } else {
        failed++
        errors.push(String(e?.message ?? e).slice(0, 160))
      }
    }
  }))
  return json(200, { ok: true, subscriptions: rows.length, sent, failed, removed, errors: errors.slice(0, 5) })
}

// ------------------ dion: النسخة الأصلية كما هي ------------------
async function handleDion(p: any) {
  if (!p?.userId) return json(400, { error: 'missing_user' })
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json(500, { error: 'vapid_not_configured' })
  setVapid()
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failed_count')
    .eq('user_id', p.userId)
    .eq('enabled', true)
  if (error) return json(500, { error: 'db_error', detail: error.message })
  const subscriptions = (subs ?? []) as any[]
  if (subscriptions.length === 0) return json(200, { sent: 0, reason: 'no_subscriptions' })
  const notification = {
    title: p.title?.trim() || 'دفتر الديون',
    body: p.body ?? '',
    kind: p.kind ?? 'info',
    url: p.url ?? '/#/notifications',
    tag: p.refId ? `${p.refType ?? 'ref'}-${p.refId}` : `daftar-${Date.now()}`,
  }
  let sent = 0
  const dead: string[] = []
  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(notification),
        { TTL: 60 * 60 * 24 },
      )
      sent += 1
      await supabase.from('push_subscriptions')
        .update({ last_seen_at: new Date().toISOString(), failed_count: 0 }).eq('id', sub.id)
    } catch (e: any) {
      const status = e?.statusCode ?? 0
      if (status === 404 || status === 410) dead.push(sub.id)
      else await supabase.from('push_subscriptions')
        .update({ failed_count: sub.failed_count + 1 }).eq('id', sub.id)
    }
  }))
  if (dead.length > 0) await supabase.from('push_subscriptions').delete().in('id', dead)
  return json(200, { sent, dead: dead.length, total: subscriptions.length })
}

// ------------------ نقطة الدخول ------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const appKey = req.headers.get('x-app-key') ?? ''
  const hookSecret = req.headers.get('x-push-secret') ?? ''
  const webhookSecret = req.headers.get('x-webhook-secret') ?? ''
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')

  const ytOk = !!(APP_PUSH_KEY && appKey === APP_PUSH_KEY)
  const dionOk = !!(PUSH_HOOK_SECRET && hookSecret === PUSH_HOOK_SECRET)
  const webhookOk = !!(WEBHOOK_SECRET && webhookSecret === WEBHOOK_SECRET)
  const serviceOk = !!(SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY)
  if (!ytOk && !dionOk && !webhookOk && !serviceOk) return json(401, { error: 'unauthorized' })

  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'invalid_json' }) }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // مسار dion: لا يحمل action الخاص بـ yt
  if (!ytOk) return handleDion(p)

  // مسار yt
  if (p?.action === 'diag') return handleDiag(admin)
  if (p?.action === 'register') return ytRegister(admin, p)
  if (p?.action === 'unregister') return ytUnregister(admin, p)
  if (p?.action === 'sync_shifts') return ytSyncShifts(admin, p)
  if (p?.action && p.action !== 'send') return json(400, { error: 'Unknown action: ' + p.action })
  return ytSend(admin, p)
})
