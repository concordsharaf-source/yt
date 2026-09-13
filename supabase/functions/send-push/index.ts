// =============================================================
// Edge Function: send-push
// نظام إشعارات Web Push يعمل مع:
//   1) تطبيق Supabase Auth (user_id / user_ids)
//   2) تطبيق بهوية محلية (app_user / app_users / notify_all) — مثل تطبيق الورديات
//
// طرق الاستدعاء (POST /functions/v1/send-push):
//   تسجيل جهاز:   { action:'register', app_user, device_id, subscription:{endpoint,keys} }
//   إلغاء جهاز:   { action:'unregister', endpoint }
//   إرسال:        { app_user|app_users|notify_all|user_id|user_ids, payload|title,body, ... }
//   Webhook رسائل: { record:{ receiver_id, content, ... } }
//
// مصادقة (أي واحدة):
//   - الترويسة x-webhook-secret = WEBHOOK_SECRET
//   - الترويسة x-app-key = APP_PUSH_KEY (من تطبيق الويب)
//   - مفتاح service_role أو JWT مستخدم Supabase
// =============================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const APP_PUSH_KEY = Deno.env.get("APP_PUSH_KEY") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret, x-app-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function decodeJwtRole(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return json?.role ?? null;
  } catch {
    return null;
  }
}

/** يتحقق من أحد أشكال المصادقة المدعومة */
async function authenticate(req: Request, admin: SupabaseClient): Promise<Response | null> {
  const hookSecret = req.headers.get("x-webhook-secret");
  if (hookSecret && WEBHOOK_SECRET && hookSecret === WEBHOOK_SECRET) return null;

  const appKey = req.headers.get("x-app-key");
  if (appKey && APP_PUSH_KEY && appKey === APP_PUSH_KEY) return null;

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return jsonResponse({ error: "Missing authorization" }, 401);
  if (SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) return null;
  if (token.startsWith("sb_secret_")) return null;
  if (decodeJwtRole(token) === "service_role") return null;

  const { error } = await admin.auth.getUser(token);
  if (error) return jsonResponse({ error: "Invalid token" }, 401);
  return null;
}

// ---------- إجراءات الاشتراك ----------

async function handleRegister(admin: SupabaseClient, p: any) {
  const sub = p?.subscription;
  const appUser: string | null = p?.app_user ? String(p.app_user) : null;
  const deviceId: string | null = p?.device_id ? String(p.device_id) : null;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return jsonResponse({ error: "subscription.endpoint and keys are required" }, 400);
  }
  // منع التكرار: جهاز واحد (device_id) = صف واحد. احذف أي اشتراك قديم لنفس الجهاز
  // بنقطة نهاية مختلفة (يحدث عند ترقية مفتاح VAPID أو سباق بين الصفحات).
  if (deviceId) {
    await admin
      .from("push_subscriptions")
      .delete()
      .eq("device_id", deviceId)
      .neq("endpoint", sub.endpoint);
  }
  // upsert على endpoint (جهاز واحد قد يبدّل مستخدمه)
  const { error } = await admin
    .from("push_subscriptions")
    .upsert(
      {
        endpoint: sub.endpoint,
        keys: sub.keys,
        app_user: appUser,
        device_id: deviceId,
        user_id: p?.user_id ?? null,
      },
      { onConflict: "endpoint" },
    );
  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ ok: true, registered: true });
}

async function handleUnregister(admin: SupabaseClient, p: any) {
  if (!p?.endpoint) return jsonResponse({ error: "endpoint required" }, 400);
  const { error } = await admin.from("push_subscriptions").delete().eq("endpoint", p.endpoint);
  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ ok: true, unregistered: true });
}

// ---------- مزامنة جدول الورديات (من التطبيق) ----------
async function handleSyncShifts(admin: SupabaseClient, p: any) {
  const rows = p?.shifts;
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonResponse({ error: "shifts[] required" }, 400);
  }
  const clean = rows
    .filter((r: any) => r?.date_key && r?.shift_date)
    .map((r: any) => ({
      date_key: String(r.date_key),
      shift_date: String(r.shift_date),
      employee_id: r.employee_id != null ? Number(r.employee_id) : null,
      employee_name: r.employee_name ? String(r.employee_name) : null,
      day_week: r.day_week != null ? Number(r.day_week) : new Date(r.shift_date).getDay(),
      updated_at: new Date().toISOString(),
    }));
  if (clean.length === 0) return jsonResponse({ error: "no valid shifts" }, 400);

  let upsertError: any = null;
  try {
    const res = await admin.from("shift_schedule").upsert(clean, { onConflict: "date_key" });
    upsertError = res.error;
  } catch (e: any) {
    upsertError = { message: String(e?.stack || e) };
  }
  if (upsertError) return jsonResponse({ error: upsertError.message, details: upsertError.details, hint: upsertError.hint, sample: clean[0] }, 500);

  // تنظيف الأيام القديمة (أقدم من أمس)
  try {
    await admin.from("shift_schedule").lt("shift_date", new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10));
  } catch {
    /* غير حرج */
  }

  return jsonResponse({ ok: true, synced: clean.length });
}

// ---------- تحديد المستلمين ----------

async function resolveRecipients(
  admin: SupabaseClient,
  p: any,
): Promise<{ rows: any[] | null; error: Response | null }> {
  let q = admin.from("push_subscriptions").select("endpoint, keys, app_user, device_id, user_id");

  // حمولة Database Webhook
  if (p?.record) {
    if (p.record.receiver_id) q = q.eq("user_id", p.record.receiver_id);
    else return { rows: null, error: jsonResponse({ error: "record.receiver_id missing" }, 400) };
  } else if (p?.notify_all) {
    // كل الأجهزة
  } else if (p?.app_users?.length || (Array.isArray(p?.app_users) === false && p?.app_user)) {
    const names = p.app_users ?? [p.app_user];
    q = q.in("app_user", names);
  } else if (p?.user_ids?.length || (Array.isArray(p?.user_ids) === false && p?.user_id)) {
    const ids = p.user_ids ?? [p.user_id];
    q = q.in("user_id", ids);
  } else {
    return { rows: null, error: jsonResponse({ error: "No recipients specified" }, 400) };
  }

  if (p?.except_device_id) q = q.neq("device_id", String(p.except_device_id));

  const { data, error } = await q;
  if (error) return { rows: null, error: jsonResponse({ error: error.message }, 500) };
  return { rows: data, error: null };
}

/** يطبّع محتوى الإشعار (يدعم الشكل المسطّح الذي يتوقعه Service Worker في تطبيق الورديات) */
function normalizePushPayload(p: any) {
  if (p?.payload && typeof p.payload === "object") return JSON.stringify(p.payload);
  if (p?.record) {
    const r = p.record;
    return JSON.stringify({
      title: r.title ?? "رسالة جديدة 💬",
      body: r.content ?? r.body ?? "لديك رسالة جديدة",
      tag: r.tag ?? `push-${Date.now()}`,
      url: r.conversation_id ? `/chat/${r.conversation_id}` : p.url ?? "./chat.html",
    });
  }
  return JSON.stringify({
    title: p?.title ?? "رسالة جديدة 💬",
    body: p?.body ?? "لديك رسالة جديدة",
    tag: p?.tag ?? `push-${Date.now()}`,
    url: p?.url ?? p?.data?.url ?? "./index.html",
    ...(p?.icon ? { icon: p.icon } : {}),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const authError = await authenticate(req, admin);
  if (authError) return authError;

  let p: any;
  try {
    p = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (p?.action === "register") return handleRegister(admin, p);
  if (p?.action === "unregister") return handleUnregister(admin, p);
  if (p?.action === "sync_shifts") return handleSyncShifts(admin, p);
  // قيم action أخرى ("send" أو بدون action) تكمل لمسار الإرسال
  if (p?.action && p.action !== "send") {
    return jsonResponse({ error: "Unknown action: " + p.action }, 400);
  }

  const { rows, error } = await resolveRecipients(admin, p);
  if (error) return error;
  if (!rows || rows.length === 0) {
    return jsonResponse({ ok: true, sent: 0, removed: 0, note: "No subscriptions found" });
  }

  const pushPayload = normalizePushPayload(p);
  let sent = 0, failed = 0, removed = 0;
  const errors: string[] = [];

  await Promise.all(
    rows.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, pushPayload);
        sent++;
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
          removed++;
        } else {
          failed++;
          errors.push(String(err?.message ?? err).slice(0, 140));
        }
      }
    }),
  );

  return jsonResponse({
    ok: true,
    subscriptions: rows.length,
    sent,
    failed,
    removed,
    errors: errors.slice(0, 5),
  });
});
