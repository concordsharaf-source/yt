-- =============================================================
-- تنبيهات الوردية المجدولة على الخادم (تصل والتطبيق مغلق)
--   • 07:00 بتوقيت اليمن (UTC+3) = 04:00 UTC  → ورديتك اليوم
--   • 20:00 بتوقيت اليمن (UTC+3) = 17:00 UTC  → ورديتك غداً
-- يستدعي Edge Function send-push بمفتاح APP_PUSH_KEY.
-- ⚠️ ضع_مفتاح_APP_PUSH_KEY يُستبدل وقت التطبيق عبر apply-cron.js
-- =============================================================

CREATE OR REPLACE FUNCTION public.send_shift_reminder(p_for_tomorrow BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
DECLARE
  v_row      public.shift_schedule%ROWTYPE;
  v_title    TEXT;
  v_body     TEXT;
  v_tag      TEXT;
  v_url      TEXT;
  v_dow      INT;
BEGIN
  SELECT * INTO v_row
  FROM public.shift_schedule
  WHERE shift_date = (CURRENT_DATE + CASE WHEN p_for_tomorrow THEN 1 ELSE 0 END);

  IF NOT FOUND OR v_row.employee_name IS NULL THEN
    RAISE NOTICE 'لا توجد وردية مجدولة للتاريخ المطلوب — تجاوز';
    RETURN;
  END IF;

  v_dow := EXTRACT(DOW FROM v_row.shift_date)::INT;   -- 0=الأحد، 5=الجمعة

  IF p_for_tomorrow THEN
    v_title := '⏰ تذكير بالوردية';
    v_body  := 'ورديتك غداً — جهّز نفسك';
    v_tag   := 'shift-notification-tomorrow_' || v_row.date_key;
  ELSE
    v_title := '⏰ تذكير بالوردية';
    IF v_dow = 5 THEN
      v_body := 'ورديتك اليوم الجمعة — جمعة مباركة 🕌';
    ELSE
      v_body := 'ورديتك اليوم — يوماً موفقاً';
    END IF;
    v_tag := 'shift-notification-' || v_row.date_key;
  END IF;
  v_url := './index.html';

  PERFORM net.http_post(
    url := 'https://pyjjaekcqbdijcyloqvx.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-app-key', 'ضع_مفتاح_APP_PUSH_KEY'
    ),
    body := jsonb_build_object(
      'app_user', v_row.employee_name,
      'payload', jsonb_build_object(
        'title', v_title,
        'body', v_body,
        'tag', v_tag,
        'url', v_url
      )
    )
  );
END;
$$;

-- إعادة جدولة نظيفة (idempotent)
SELECT cron.unschedule('shift-reminder-morning') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'shift-reminder-morning');
SELECT cron.unschedule('shift-reminder-evening') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'shift-reminder-evening');

SELECT cron.schedule(
  'shift-reminder-morning',
  '0 4 * * *',                       -- 07:00 توقيت اليمن
  $$SELECT public.send_shift_reminder(FALSE);$$
);
SELECT cron.schedule(
  'shift-reminder-evening',
  '0 17 * * *',                      -- 20:00 توقيت اليمن (تذكير بالغد)
  $$SELECT public.send_shift_reminder(TRUE);$$
);
