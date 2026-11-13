-- Patron mechanics come from the same catalog as hero creation.
create or replace function private.one_ring_patron_bonus(p_patron_id text)
returns integer language sql immutable set search_path=pg_catalog,private as $$
  select (p->>'bonus')::integer from jsonb_array_elements(private.one_ring_catalog()->'patrons') p where p->>'id'=p_patron_id
$$;
revoke all on function private.one_ring_patron_bonus(text) from public,anon,authenticated;

create table public.one_ring_companies (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references public.campaigns(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  patron_id text check (patron_id is null or private.one_ring_patron_bonus(patron_id) is not null),
  safe_havens text[] not null default '{}',
  spent_this_session integer not null default 0 check (spent_this_session >= 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  check (cardinality(safe_havens) <= 30),
  unique (id, campaign_id)
);

create table public.one_ring_company_members (
  company_id uuid not null references public.one_ring_companies(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  primary key (company_id, sheet_id),
  unique (sheet_id),
  foreign key (company_id, campaign_id) references public.one_ring_companies(id, campaign_id) on delete cascade,
  foreign key (sheet_id, campaign_id) references public.character_sheets(id, campaign_id) on delete cascade
);

create table public.one_ring_company_focuses (
  company_id uuid not null references public.one_ring_companies(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  source_sheet_id uuid not null,
  target_sheet_id uuid not null,
  primary key (company_id, source_sheet_id),
  check (source_sheet_id <> target_sheet_id),
  foreign key (company_id, campaign_id) references public.one_ring_companies(id, campaign_id) on delete cascade,
  foreign key (company_id, source_sheet_id) references public.one_ring_company_members(company_id, sheet_id) on delete cascade,
  foreign key (company_id, target_sheet_id) references public.one_ring_company_members(company_id, sheet_id) on delete cascade
);

create table public.one_ring_company_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.one_ring_companies(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  operation_id uuid not null,
  kind text not null check (kind in ('spend','restore','reset_session')),
  amount integer not null check (amount >= 0),
  reason text,
  actor_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid,
  created_at timestamptz not null default now(),
  unique (company_id, operation_id),
  foreign key (company_id, campaign_id) references public.one_ring_companies(id, campaign_id) on delete cascade
);

create table public.one_ring_company_session_resets (
  company_id uuid not null references public.one_ring_companies(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null,
  operation_id uuid not null,
  reset_at timestamptz not null default now(),
  primary key (company_id, session_id),
  unique (company_id, operation_id),
  foreign key (company_id, campaign_id) references public.one_ring_companies(id, campaign_id) on delete cascade,
  foreign key (session_id, campaign_id) references public.campaign_sessions(id, campaign_id) on delete cascade
);

create table public.one_ring_company_notifications (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  company_id uuid not null references public.one_ring_companies(id) on delete cascade,
  version integer not null check (version > 0),
  updated_at timestamptz not null default now()
);
alter table public.one_ring_company_notifications enable row level security;
create policy "campaign members read company notifications" on public.one_ring_company_notifications
  for select to authenticated using (private.is_campaign_member(campaign_id));
revoke all on public.one_ring_company_notifications from public, anon, authenticated;
grant select on public.one_ring_company_notifications to authenticated;

create or replace function private.one_ring_company_notify()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  insert into public.one_ring_company_notifications(campaign_id,company_id,version,updated_at)
  values(new.campaign_id,new.id,new.version,now()) on conflict(campaign_id) do update
    set company_id=excluded.company_id,version=excluded.version,updated_at=excluded.updated_at;
  return new;
end $$;
revoke all on function private.one_ring_company_notify() from public,anon,authenticated;
create trigger one_ring_company_notify after insert or update on public.one_ring_companies
  for each row execute function private.one_ring_company_notify();

create table private.one_ring_company_receipts (
  actor_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  operation_id uuid not null,
  expected_version integer not null,
  kind text not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{32}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, campaign_id, operation_id)
);
alter table private.one_ring_company_receipts enable row level security;
revoke all on private.one_ring_company_receipts from public, anon, authenticated;

alter table public.one_ring_companies enable row level security;
alter table public.one_ring_company_members enable row level security;
alter table public.one_ring_company_focuses enable row level security;
alter table public.one_ring_company_events enable row level security;
alter table public.one_ring_company_session_resets enable row level security;
revoke all on public.one_ring_companies, public.one_ring_company_members, public.one_ring_company_focuses,
  public.one_ring_company_events, public.one_ring_company_session_resets from public, anon, authenticated;

create or replace function public.one_ring_company_snapshot(p_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, auth as $$
declare c public.one_ring_companies%rowtype; result jsonb;
begin
  if auth.uid() is null or not private.is_campaign_member(p_campaign_id) then raise exception using errcode='42501', message='campaign access denied'; end if;
  select * into c from public.one_ring_companies where campaign_id=p_campaign_id;
  if not found then return jsonb_build_object('company',null,'members','[]'::jsonb,'focuses','[]'::jsonb,'events','[]'::jsonb,'reset_sessions','[]'::jsonb); end if;
  select jsonb_build_object(
    'company', jsonb_build_object('id',c.id,'campaign_id',c.campaign_id,'name',c.name,'patron_id',c.patron_id,'safe_havens',c.safe_havens,'version',c.version,'spent_this_session',c.spent_this_session,
      'society_max',(select count(*) from public.one_ring_company_members m where m.company_id=c.id)
        +(select count(*) from public.one_ring_company_members m join public.character_sheets s on s.id=m.sheet_id
          where m.company_id=c.id and s.values->>'linhagem'='Homens de Bri')
        +coalesce(private.one_ring_patron_bonus(c.patron_id),0),
      'society_current',greatest(0,
        (select count(*) from public.one_ring_company_members m where m.company_id=c.id)
        +(select count(*) from public.one_ring_company_members m join public.character_sheets s on s.id=m.sheet_id
          where m.company_id=c.id and s.values->>'linhagem'='Homens de Bri')
        +coalesce(private.one_ring_patron_bonus(c.patron_id),0)-c.spent_this_session)),
    'members',coalesce((select jsonb_agg(jsonb_build_object('sheet_id',s.id,'name',s.name,'owner_id',s.owner_id,'society_bonus',case when s.values->>'linhagem'='Homens de Bri' then 1 else 0 end) order by s.name,s.id)
      from public.one_ring_company_members m join public.character_sheets s on s.id=m.sheet_id where m.company_id=c.id),'[]'::jsonb),
    'focuses',coalesce((select jsonb_agg(jsonb_build_object('source_sheet_id',f.source_sheet_id,'target_sheet_id',f.target_sheet_id) order by f.source_sheet_id)
      from public.one_ring_company_focuses f where f.company_id=c.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'operation_id',e.operation_id,'kind',e.kind,'amount',e.amount,'reason',e.reason,'actor_id',e.actor_id,'created_at',e.created_at) order by e.created_at,e.id)
      from (select * from public.one_ring_company_events where company_id=c.id order by created_at desc limit 200) e),'[]'::jsonb),
    'reset_sessions',coalesce((select jsonb_agg(jsonb_build_object('session_id',r.session_id,'reset_at',r.reset_at) order by r.reset_at)
      from public.one_ring_company_session_resets r where r.company_id=c.id),'[]'::jsonb)) into result;
  return result;
end $$;

create or replace function public.one_ring_company_command(p_campaign_id uuid,p_operation_id uuid,p_expected_version integer,p_kind text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, auth as $$
declare uid uuid:=auth.uid(); c public.one_ring_companies%rowtype; receipt private.one_ring_company_receipts%rowtype;
  v_company_id uuid; v_sheet_id uuid; source_id uuid; target_id uuid; v_session_id uuid; amount_value integer; society_maximum integer;
  result jsonb; reason_value text; v_request_digest text;
begin
  if uid is null or not private.is_campaign_member(p_campaign_id) then raise exception using errcode='42501', message='campaign access denied'; end if;
  if p_operation_id is null or p_expected_version is null or p_expected_version<0 or (p_kind is null or p_kind not in ('create','configure','add_member','remove_member','set_focus','spend','restore','reset_session')) or p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='22023', message='invalid command';
  end if;
  if (p_kind in ('create','configure') and (p_payload-'name'-'patron_id'-'safe_havens'<>'{}'::jsonb or (select count(*) from jsonb_object_keys(p_payload))<>3
        or jsonb_typeof(p_payload->'name') is distinct from 'string' or char_length(p_payload->>'name') not between 1 and 120
        or (p_payload->'patron_id'<>'null'::jsonb and private.one_ring_patron_bonus(p_payload->>'patron_id') is null)
        or jsonb_typeof(p_payload->'safe_havens') is distinct from 'array' or jsonb_array_length(p_payload->'safe_havens')>30))
    or (p_kind in ('add_member','remove_member') and (p_payload-'sheet_id'<>'{}'::jsonb or (select count(*) from jsonb_object_keys(p_payload))<>1 or coalesce(p_payload->>'sheet_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    or (p_kind='set_focus' and (p_payload-'source_sheet_id'-'target_sheet_id'<>'{}'::jsonb or (select count(*) from jsonb_object_keys(p_payload))<>2 or coalesce(p_payload->>'source_sheet_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(p_payload->>'target_sheet_id','null') not in ('null') and (p_payload->>'target_sheet_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    or (p_kind in ('spend','restore') and (p_payload-'amount'-'reason'<>'{}'::jsonb or (select count(*) from jsonb_object_keys(p_payload))<>2 or jsonb_typeof(p_payload->'amount') is distinct from 'number' or coalesce(p_payload->>'amount','') !~ '^[1-9][0-9]{0,4}$' or (p_payload->>'amount')::numeric>10000 or jsonb_typeof(p_payload->'reason') is distinct from 'string' or char_length(p_payload->>'reason') not between 1 and 200))
    or (p_kind='reset_session' and (p_payload-'session_id'<>'{}'::jsonb or (select count(*) from jsonb_object_keys(p_payload))<>1 or coalesce(p_payload->>'session_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
    raise exception using errcode='22023', message='invalid command payload';
  end if;
  if p_kind in ('create','configure') then
    if exists(select 1 from jsonb_array_elements(p_payload->'safe_havens') h where jsonb_typeof(h)<>'string' or char_length(h#>>'{}') not between 1 and 120) then
      raise exception using errcode='22023',message='invalid safe haven';
    end if;
  end if;
  if p_kind in ('create','configure','add_member','remove_member','spend','restore','reset_session') and not private.can_manage_campaign(p_campaign_id) then
    raise exception using errcode='42501', message='manager required';
  end if;
  if p_kind='set_focus' and not private.can_manage_campaign(p_campaign_id) and not exists(select 1 from public.campaign_members m where m.campaign_id=p_campaign_id and m.user_id=uid and m.role='player') then
    raise exception using errcode='42501',message='player or manager required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('one-ring-company:'||p_campaign_id::text,0));
  select id into v_company_id from public.one_ring_companies where campaign_id=p_campaign_id;
  v_request_digest:=md5(p_expected_version::text||'|'||p_kind||'|'||p_payload::text);
  select * into receipt from private.one_ring_company_receipts where actor_id=uid and campaign_id=p_campaign_id and operation_id=p_operation_id;
  if found then
    if receipt.expected_version<>p_expected_version or receipt.kind<>p_kind or receipt.request_digest<>v_request_digest then raise exception using errcode='23505', message='operation id reused'; end if;
    return receipt.result;
  end if;
  if p_kind='set_focus' and not private.can_manage_campaign(p_campaign_id) then
    source_id:=nullif(p_payload->>'source_sheet_id','')::uuid;
    if not exists(select 1 from public.one_ring_company_members m join public.character_sheets s on s.id=m.sheet_id
      where m.company_id=v_company_id and m.sheet_id=source_id and s.owner_id=uid) then
      raise exception using errcode='42501', message='own sheet required';
    end if;
  end if;
  if p_kind='create' then
    if p_expected_version<>0 or v_company_id is not null then raise exception using errcode='40001', message='company already exists'; end if;
    insert into public.one_ring_companies(campaign_id,name,patron_id,safe_havens,version)
      values(p_campaign_id,p_payload->>'name',nullif(p_payload->>'patron_id',''),array(select jsonb_array_elements_text(p_payload->'safe_havens')),1)
      returning * into c;
  else
    if v_company_id is null then raise exception using errcode='P0002', message='company not found'; end if;
    select * into c from public.one_ring_companies where id=v_company_id for update;
    if c.version<>p_expected_version then raise exception using errcode='40001', message='company version conflict'; end if;
    case p_kind
      when 'configure' then update public.one_ring_companies set name=p_payload->>'name',patron_id=nullif(p_payload->>'patron_id',''),safe_havens=array(select jsonb_array_elements_text(p_payload->'safe_havens')) where id=c.id;
      when 'add_member' then
        v_sheet_id:=(p_payload->>'sheet_id')::uuid;
        if not exists(select 1 from public.character_sheets s join public.system_templates t on t.id=s.template_id where s.id=v_sheet_id and s.campaign_id=p_campaign_id and t.campaign_id=p_campaign_id and t.status='approved' and t.schema->>'system_key'='one-ring') then
          raise exception using errcode='22023', message='approved One Ring sheet required'; end if;
        insert into public.one_ring_company_members(company_id,campaign_id,sheet_id) values(c.id,p_campaign_id,v_sheet_id);
      when 'remove_member' then delete from public.one_ring_company_members where company_id=c.id and sheet_id=(p_payload->>'sheet_id')::uuid;
      when 'set_focus' then
        source_id:=(p_payload->>'source_sheet_id')::uuid; target_id:=nullif(p_payload->>'target_sheet_id','')::uuid;
        if not exists(select 1 from public.one_ring_company_members m where m.company_id=c.id and m.sheet_id=source_id) then raise exception using errcode='22023',message='source must be a company member'; end if;
        if target_id is not null and not exists(select 1 from public.one_ring_company_members m where m.company_id=c.id and m.sheet_id=target_id) then raise exception using errcode='22023',message='target must be a company member'; end if;
        if target_id is null then delete from public.one_ring_company_focuses where company_id=c.id and source_sheet_id=source_id;
        else insert into public.one_ring_company_focuses(company_id,campaign_id,source_sheet_id,target_sheet_id) values(c.id,p_campaign_id,source_id,target_id)
          on conflict(company_id,source_sheet_id) do update set target_sheet_id=excluded.target_sheet_id; end if;
      when 'spend' then
        amount_value:=(p_payload->>'amount')::integer; reason_value:=p_payload->>'reason';
        select count(*)+(select count(*) from public.one_ring_company_members m join public.character_sheets s on s.id=m.sheet_id where m.company_id=c.id and s.values->>'linhagem'='Homens de Bri')
          +coalesce(private.one_ring_patron_bonus(c.patron_id),0)
          into society_maximum from public.one_ring_company_members where company_id=c.id;
        if greatest(0,society_maximum-c.spent_this_session)<amount_value then raise exception using errcode='23514',message='insufficient society'; end if;
        update public.one_ring_companies set spent_this_session=spent_this_session+amount_value where id=c.id;
        insert into public.one_ring_company_events(company_id,campaign_id,operation_id,kind,amount,reason,actor_id) values(c.id,p_campaign_id,p_operation_id,'spend',amount_value,reason_value,uid);
      when 'restore' then
        amount_value:=(p_payload->>'amount')::integer; reason_value:=p_payload->>'reason';
        if amount_value>c.spent_this_session then raise exception using errcode='23514',message='restore exceeds spent amount'; end if;
        update public.one_ring_companies set spent_this_session=spent_this_session-amount_value where id=c.id;
        insert into public.one_ring_company_events(company_id,campaign_id,operation_id,kind,amount,reason,actor_id) values(c.id,p_campaign_id,p_operation_id,'restore',amount_value,reason_value,uid);
      when 'reset_session' then
        v_session_id:=(p_payload->>'session_id')::uuid;
        if not exists(select 1 from public.campaign_sessions s where s.id=v_session_id and s.campaign_id=p_campaign_id and s.status='played') then raise exception using errcode='22023',message='played campaign session required'; end if;
        insert into public.one_ring_company_session_resets(company_id,campaign_id,session_id,operation_id) values(c.id,p_campaign_id,v_session_id,p_operation_id) on conflict(company_id,session_id) do nothing;
        if found then
          amount_value:=c.spent_this_session;
          update public.one_ring_companies set spent_this_session=0 where id=c.id;
          insert into public.one_ring_company_events(company_id,campaign_id,operation_id,kind,amount,actor_id,session_id) values(c.id,p_campaign_id,p_operation_id,'reset_session',amount_value,uid,v_session_id);
        end if;
      else null;
    end case;
    update public.one_ring_companies set version=version+1 where id=c.id returning * into c;
  end if;
  result:=public.one_ring_company_snapshot(p_campaign_id);
  insert into private.one_ring_company_receipts(actor_id,campaign_id,operation_id,expected_version,kind,request_digest,result)
    values(uid,p_campaign_id,p_operation_id,p_expected_version,p_kind,v_request_digest,result);
  return result;
end $$;

revoke all on function public.one_ring_company_snapshot(uuid) from public, anon;
revoke all on function public.one_ring_company_command(uuid,uuid,integer,text,jsonb) from public, anon;
grant execute on function public.one_ring_company_snapshot(uuid) to authenticated;
grant execute on function public.one_ring_company_command(uuid,uuid,integer,text,jsonb) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.one_ring_company_notifications;
  end if;
exception when duplicate_object then null;
end $$;
