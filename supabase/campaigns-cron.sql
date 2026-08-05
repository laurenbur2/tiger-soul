-- ============================================================
-- Tiger Soul — OPTIONAL: run scheduled campaigns automatically.
-- Only needed if you want "Schedule for later" to fire on its own. Without
-- this, scheduled campaigns simply wait and you can send them with "Send now".
--
-- Run once in Supabase → SQL Editor. Requires the pg_cron + pg_net extensions
-- (both available on Supabase). Replace the service-role key placeholder first.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every 5 minutes, ask the dispatch-scheduled function to send anything due.
-- The Authorization header carries the SERVICE ROLE key so the (JWT-verified)
-- function accepts the call. Paste your service_role key where shown
-- (Supabase → Project Settings → API → service_role — keep it secret).
select cron.schedule(
  'tiger-soul-dispatch-scheduled',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://werkohszkcytdvljafha.supabase.co/functions/v1/dispatch-scheduled',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer PASTE_SERVICE_ROLE_KEY_HERE'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- To remove later:  select cron.unschedule('tiger-soul-dispatch-scheduled');
