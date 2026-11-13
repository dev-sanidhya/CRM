-- Signed-out visitors cannot call the import functions at all (they already
-- refused inside; this removes them from the public API surface).
revoke execute on function public.delete_sheet_import(uuid) from anon, public;
revoke execute on function public.import_leads(uuid, jsonb, text, text) from anon, public;
grant execute on function public.delete_sheet_import(uuid) to authenticated;
grant execute on function public.import_leads(uuid, jsonb, text, text) to authenticated;
