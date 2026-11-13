-- Quick-added leads go straight to "Due now" on Today, and re-adding a
-- closed number reopens it.
create or replace function public.quick_add_lead(
  p_name text,
  p_phone text,
  p_city text default null,
  p_assign uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_assignee uuid;
  v_existing public.leads%rowtype;
  v_id uuid;
  v_existing_flag boolean := false;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_phone), '') = '' then
    raise exception 'Name and phone are required';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  v_assignee := case when v_role = 'caller' then v_uid else p_assign end;

  select * into v_existing from public.leads where phone = p_phone;
  if found then
    if not (v_existing.assigned_to is null or v_existing.assigned_to = v_assignee or v_role = 'founder') then
      raise exception 'This number is already with another caller';
    end if;
    update public.leads
    set assigned_to = coalesce(v_existing.assigned_to, v_assignee),
        closed_at = null, closed_reason = null,
        stage = case when stage = 'lost' then 'contacted'::lead_stage else stage end
    where id = v_existing.id;
    v_id := v_existing.id;
    v_existing_flag := true;
  else
    insert into public.leads (business_name, phone, city, assigned_to)
    values (btrim(p_name), p_phone, nullif(btrim(coalesce(p_city, '')), ''), v_assignee)
    returning id into v_id;
  end if;

  if not exists (select 1 from public.reminders where lead_id = v_id and status <> 'done' and kind <> 'demo') then
    insert into public.reminders (lead_id, assigned_to, due_at, note, source, kind)
    select v_id, l.assigned_to, now(), 'Added by hand', 'manual', 'follow_up'
    from public.leads l where l.id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'existing', v_existing_flag);
end;
$$;

revoke execute on function public.quick_add_lead(text, text, text, uuid) from anon, public;
grant execute on function public.quick_add_lead(text, text, text, uuid) to authenticated;
