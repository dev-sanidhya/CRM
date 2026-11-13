-- Live lead count per import for the Import page, without downloading
-- every lead row to count them in the browser.
create or replace function public.get_import_lead_counts()
returns table (import_id uuid, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select sheet_import_id, count(*) from public.leads
  where sheet_import_id is not null
  group by sheet_import_id;
$$;

revoke execute on function public.get_import_lead_counts() from anon, public;
grant execute on function public.get_import_lead_counts() to authenticated;
