-- دعم هوية تطبيق الورديات (أسماء الموظفين بدون Supabase Auth)
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS app_user TEXT;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS device_id TEXT;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_app_user
  ON public.push_subscriptions (app_user);
