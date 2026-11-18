-- Keep the Telegram bot's free Render instance awake (Render sleeps it after 15 idle minutes):
-- Supabase's pg_cron pings <render_url>/health every 5 minutes via pg_net. The address is stored
-- in bot_state (key 'render_url'); until it is set the job does nothing.
--   insert into bot_state (key, value) values ('render_url', '"https://<service>.onrender.com"')
--   on conflict (key) do update set value = excluded.value;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

create or replace function ops.ping_bot()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
begin
  select value #>> '{}' into v_url from public.bot_state where key = 'render_url';
  if v_url is null or v_url = '' then
    return;
  end if;
  perform net.http_get(url := rtrim(v_url, '/') || '/health', timeout_milliseconds := 20000);
end;
$$;
revoke all on function ops.ping_bot() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'keep-bot-awake';
select cron.schedule('keep-bot-awake', '*/5 * * * *', 'select ops.ping_bot()');

select cron.unschedule(jobid) from cron.job where jobname = 'trim-net-responses';
select cron.schedule('trim-net-responses', '17 3 * * *', $$delete from net._http_response where created < now() - interval '1 day'$$);
