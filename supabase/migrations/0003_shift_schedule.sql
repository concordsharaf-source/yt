-- =============================================================
-- جدول جدول الورديات المتزامن من التطبيق، لاستخدامه في تنبيهات Push
-- =============================================================

CREATE TABLE IF NOT EXISTS public.shift_schedule (
  date_key       TEXT PRIMARY KEY,          -- بصيغة YYYY-M-D كما يحسبها التطبيق
  shift_date     DATE NOT NULL,             -- للتطابق مع current_date داخل cron
  employee_id    INTEGER,
  employee_name  TEXT,                       -- نفس الاسم في push_subscriptions.app_user
  day_week       SMALLINT,                   -- 0=الأحد .. 5=الجمعة .. 6=السبت
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_schedule_date ON public.shift_schedule (shift_date);

ALTER TABLE public.shift_schedule ENABLE ROW LEVEL SECURITY;
-- لا يصل إليها العملاء مباشرة؛ كل القراءة/الكتابة عبر الدالة بمفتاح service_role
-- (لا حاجة لسياسات قراءة للمستخدمين)
