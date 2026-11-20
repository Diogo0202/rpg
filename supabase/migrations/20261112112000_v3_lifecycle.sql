-- Revised V3 core, pp. 216-218, Drive 1MTZJkyzQNQV-AMCiZtzVF_F_hxLi-cGN.
-- State lives outside template values so existing approved templates remain valid.
create table public.v3_life_states (
  sheet_id uuid primary key references public.character_sheets(id) on delete cascade,
  state text not null check (state in ('active','torpor','final_death')),
  updated_at timestamptz not null default now()
);
create table public.v3_life_operations (
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  operation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  primary key (sheet_id, actor_id, operation_id)
);
alter table public.v3_life_states enable row level security;
alter table public.v3_life_operations enable row level security;
grant select on public.v3_life_states, public.v3_life_operations to authenticated;
create policy "read permitted V3 life state" on public.v3_life_states for select to authenticated
  using (exists(select 1 from public.character_sheets s where s.id = sheet_id));
create policy "read own permitted V3 receipt" on public.v3_life_operations for select to authenticated
  using (actor_id = auth.uid() and exists(select 1 from public.character_sheets s where s.id = sheet_id));

create function public.v3_life_action(
  p_sheet_id uuid, p_operation_id uuid, p_action text,
  p_amount integer default null, p_kind text default null, p_note text default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, auth as $$
declare
  sheet public.character_sheets;
  receipt public.v3_life_operations;
  request_body jsonb := jsonb_build_object('action',p_action,'amount',p_amount,'kind',p_kind,'note',p_note);
  current_state text;
  target_state text;
  patch jsonb := '{}'::jsonb;
  result jsonb;
  field_id text := 'pontos_sangue';
  before_value integer;
  after_value integer;
  effective integer := 0;
  applied integer := 0;
  overflow integer := 0;
  marked integer;
  blood_max integer;
  manager boolean;
begin
  if auth.uid() is null then raise exception 'session required' using errcode='42501'; end if;
  if p_operation_id is null or p_action is null or p_action not in ('dano','alimentar','torpor','despertar','morte_final') then
    raise exception 'invalid V3 life action' using errcode='22023';
  end if;
  select * into sheet from public.character_sheets where id=p_sheet_id for update;
  manager := private.can_manage_campaign(sheet.campaign_id);
  if sheet.id is null or not ((sheet.owner_id=auth.uid() and private.is_campaign_player(sheet.campaign_id)) or manager) then
    raise exception 'sheet not writable' using errcode='42501';
  end if;
  if not exists(select 1 from public.system_templates t where t.id=sheet.template_id
    and t.campaign_id=sheet.campaign_id and t.status='approved' and t.schema->>'system_key'='vampire-v3') then
    raise exception 'not an approved V3 sheet' using errcode='22023';
  end if;
  select * into receipt from public.v3_life_operations
    where sheet_id=p_sheet_id and actor_id=auth.uid() and operation_id=p_operation_id;
  if found then
    if receipt.request is distinct from request_body then raise exception 'operation already used' using errcode='23505'; end if;
    return receipt.result || jsonb_build_object('replayed',true);
  end if;
  if exists(select 1 from public.character_sheet_events where sheet_id=p_sheet_id and actor_id=auth.uid() and operation_id=p_operation_id) then
    raise exception 'operation already used' using errcode='23505';
  end if;
  select state into current_state from public.v3_life_states where sheet_id=p_sheet_id;
  current_state := coalesce(current_state,'active');
  target_state := current_state;
  if current_state='final_death' then raise exception 'Final Death is permanent' using errcode='23514'; end if;
  marked := private.v3_number(sheet.values,'dano_contundente')+private.v3_number(sheet.values,'dano_letal')+private.v3_number(sheet.values,'dano_agravado');
  if p_action='dano' then
    if p_kind is null or p_kind not in ('contundente','letal','agravado') or p_amount is null or p_amount not between 1 and 20 then
      raise exception 'invalid damage' using errcode='22023';
    end if;
    field_id := 'dano_'||p_kind;
    effective := case when p_kind='contundente' then p_amount/2 else p_amount end;
    applied := least(effective,greatest(0,7-marked));
    overflow := effective-applied;
    patch := jsonb_build_object(field_id,private.v3_number(sheet.values,field_id)+applied);
    if p_kind='agravado' and effective>0 and marked+effective>=7 then target_state:='final_death';
    elsif overflow>0 or (marked+applied=7 and private.v3_number(sheet.values,'pontos_sangue')=0) then target_state:='torpor'; end if;
  else
    if not manager then raise exception 'narrator confirmation required' using errcode='42501'; end if;
    if p_note is null or length(btrim(p_note)) not between 12 and 240 then raise exception 'record the table decision' using errcode='22023'; end if;
    if p_action='alimentar' then
      if p_amount is null or p_amount not between 1 and 50 then raise exception 'invalid feeding amount' using errcode='22023'; end if;
      select limits.blood_max into blood_max from private.v3_blood_limits(sheet.values) limits;
      applied := least(p_amount,greatest(0,blood_max-private.v3_number(sheet.values,'pontos_sangue')));
      patch := jsonb_build_object('pontos_sangue',private.v3_number(sheet.values,'pontos_sangue')+applied);
      overflow := p_amount-applied;
    elsif p_action='torpor' then target_state:='torpor';
    elsif p_action='morte_final' then target_state:='final_death';
    elsif p_action='despertar' then
      if current_state<>'torpor' or private.v3_number(sheet.values,'pontos_sangue')<1 then
        raise exception 'awakening needs torpor and blood' using errcode='23514';
      end if;
      -- Narrator records completed rest and successful Awakening test; see core p.216.
      target_state:='active';
      patch := jsonb_build_object('pontos_sangue',private.v3_number(sheet.values,'pontos_sangue')-1);
      if marked>=7 then
        field_id := case when private.v3_number(sheet.values,'dano_contundente')>0 then 'dano_contundente'
                         when private.v3_number(sheet.values,'dano_letal')>0 then 'dano_letal' else 'dano_agravado' end;
        patch := patch || jsonb_build_object(field_id,private.v3_number(sheet.values,field_id)-1);
      end if;
    end if;
  end if;
  before_value:=private.v3_number(sheet.values,field_id);
  after_value:=coalesce((patch->>field_id)::integer,before_value);
  result:=private.v3_write(sheet,p_operation_id,patch,field_id,after_value-before_value,
    'v3 life '||p_action||' '||request_body::text);
  insert into public.v3_life_states(sheet_id,state) values(p_sheet_id,target_state)
    on conflict(sheet_id) do update set state=excluded.state,updated_at=now();
  result:=result||jsonb_build_object('state',target_state,'applied',applied,'unapplied',overflow,
    'excess_resolved',p_action='dano' and overflow>0);
  insert into public.v3_life_operations(sheet_id,actor_id,operation_id,request,result)
    values(p_sheet_id,auth.uid(),p_operation_id,request_body,result);
  return result;
end;
$$;
revoke all on function public.v3_life_action(uuid,uuid,text,integer,text,text) from public,anon;
grant execute on function public.v3_life_action(uuid,uuid,text,integer,text,text) to authenticated;

create or replace function public.v3_apply_damage(p_sheet_id uuid,p_operation_id uuid,p_kind text,p_amount integer)
returns jsonb language sql security invoker set search_path=pg_catalog,public as $$
  select public.v3_life_action(p_sheet_id,p_operation_id,'dano',p_amount,p_kind,null)
$$;

create function public.v3_life_state(p_sheet_id uuid) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,auth as $$
begin
  if auth.uid() is null or not exists(select 1 from public.character_sheets where id=p_sheet_id) then
    raise exception 'sheet not readable' using errcode='42501';
  end if;
  return jsonb_build_object('state',coalesce((select state from public.v3_life_states where sheet_id=p_sheet_id),'active'));
end;
$$;
revoke all on function public.v3_life_state(uuid) from public,anon;
grant execute on function public.v3_life_state(uuid) to authenticated;

alter function private.v3_lock_sheet(uuid) rename to v3_lock_sheet_before_life_state;
create function private.v3_lock_sheet(p_sheet_id uuid) returns public.character_sheets
language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare sheet public.character_sheets;
begin
  sheet:=private.v3_lock_sheet_before_life_state(p_sheet_id);
  if exists(select 1 from public.v3_life_states where sheet_id=p_sheet_id and state='final_death') then
    raise exception 'Final Death is permanent' using errcode='23514';
  end if;
  return sheet;
end;
$$;
revoke all on function private.v3_lock_sheet(uuid) from public;
grant execute on function private.v3_lock_sheet(uuid) to authenticated;

alter function private.v3_check_blood(public.character_sheets,integer,text) rename to v3_check_blood_before_life_state;
create function private.v3_check_blood(p_sheet public.character_sheets,p_amount integer,p_turn text) returns void
language plpgsql stable security invoker set search_path=pg_catalog,public,private as $$
begin
  if exists(select 1 from public.v3_life_states where sheet_id=p_sheet.id and state<>'active') then
    raise exception 'dormant or dead vampire cannot spend blood' using errcode='23514';
  end if;
  perform private.v3_check_blood_before_life_state(p_sheet,p_amount,p_turn);
end;
$$;
revoke all on function private.v3_check_blood(public.character_sheets,integer,text) from public;
grant execute on function private.v3_check_blood(public.character_sheets,integer,text) to authenticated;
