-- =============================================================
-- نظام الإشعارات Push Notifications لتطبيق المحادثات
-- الجدول الأساسي: اشتراكات Web Push
-- =============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- المستخدم يدير اشتراكاته فقط (مع WITH CHECK الضمني من USING في سياسة FOR ALL)
CREATE POLICY "Users can manage own subscription"
  ON push_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- خدمة الإرسال (service_role / Edge Function) تقرأ كل الاشتراكات
-- ملاحظة: service_role يتجاوز RLS أصلاً، لكن السياسة تضمن الوضوح والتوثيق
CREATE POLICY "Service role can read all"
  ON push_subscriptions FOR SELECT
  USING (auth.role() = 'service_role');

-- فهرس لتسريع جلب اشتراكات مستخدم معين عند إرسال الإشعار
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON push_subscriptions (user_id);

-- (اختياري) تفعيل Realtime للجدول إن احتجته الواجهة لاحقاً
-- ALTER PUBLICATION supabase_realtime ADD TABLE push_subscriptions;
