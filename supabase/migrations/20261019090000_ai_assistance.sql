-- AI proposals remain private until a manager publishes reviewed fields.
create table public.ai_requests (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns(id) on delete cascade,
 author_id uuid not null references auth.users(id) on delete restrict,
 kind text not null check(kind in ('sheet','session','npc')),
 status text not null default 'generating' check(status in ('generating','pending','approved','rejected','failed')),
 version integer not null default 1 check(version>0), target_id uuid,
 template_id uuid references public.system_templates(id) on delete restrict,
 brief text not null check(char_length(brief) between 1 and 6000), idempotency_key uuid not null,
 request_hash text not null check(char_length(request_hash) between 16 and 128), target_version integer check(target_version is null or target_version>0),
 destination_id uuid, last_operation_id uuid, last_operation_hash text,
 input_tokens integer check(input_tokens is null or input_tokens>=0), output_tokens integer check(output_tokens is null or output_tokens>=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(campaign_id,author_id,idempotency_key), unique(id,campaign_id),
 check((kind='sheet' and template_id is not null) or kind<>'sheet')
);
create index ai_requests_campaign_created_idx on public.ai_requests(campaign_id,created_at desc);
create function private.touch_ai_request() returns trigger language plpgsql set search_path=pg_catalog as $$
begin new.updated_at:=clock_timestamp(); return new; end $$;
revoke all on function private.touch_ai_request() from public;
create trigger ai_request_touch before update on public.ai_requests for each row execute function private.touch_ai_request();
create table public.ai_proposal_contents (
 request_id uuid primary key, campaign_id uuid not null references public.campaigns(id) on delete cascade,
 context jsonb not null default '{}'::jsonb check(jsonb_typeof(context)='object' and pg_column_size(context)<=65536),
 result jsonb not null check(jsonb_typeof(result)='object' and pg_column_size(result)<=65536),
 template_snapshot jsonb check(template_snapshot is null or jsonb_typeof(template_snapshot)='object'),
 publication jsonb not null default '{}'::jsonb check(jsonb_typeof(publication)='object' and pg_column_size(publication)<=65536),
 created_at timestamptz not null default now(),
 foreign key(request_id,campaign_id) references public.ai_requests(id,campaign_id) on delete cascade
);
create table public.ai_private_preparations (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns(id) on delete cascade,
 request_id uuid not null unique, kind text not null check(kind in ('session','npc')), target_id uuid,
 target_version integer check(target_version is null or target_version>0), title text not null check(char_length(title) between 1 and 200),
 body jsonb not null default '{}'::jsonb check(jsonb_typeof(body)='object' and pg_column_size(body)<=65536),
 version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(request_id,campaign_id) references public.ai_requests(id,campaign_id) on delete cascade
);
alter table public.ai_requests enable row level security;
alter table public.ai_proposal_contents enable row level security;
alter table public.ai_private_preparations enable row level security;
create policy ai_requests_read_members on public.ai_requests for select to authenticated using((author_id=(select auth.uid()) and private.is_campaign_member(campaign_id)) or private.can_manage_campaign(campaign_id));
create policy ai_contents_read_managers on public.ai_proposal_contents for select to authenticated using(private.can_manage_campaign(campaign_id));
create policy ai_preparations_read_managers on public.ai_private_preparations for select to authenticated using(private.can_manage_campaign(campaign_id));
revoke all on public.ai_requests,public.ai_proposal_contents,public.ai_private_preparations from public,anon,authenticated;
grant select on public.ai_requests,public.ai_proposal_contents,public.ai_private_preparations to authenticated;
grant all on public.ai_requests,public.ai_proposal_contents,public.ai_private_preparations to service_role;

-- Paid provider gate: 30,000,000 micro-USD per Sao Paulo month, two global leases,
-- one per campaign, and two requests per user per rolling 60 seconds.
-- Uncertain provider calls keep their financial reserve.
create table public.ai_budget_state(singleton boolean primary key default true check(singleton),
 month_start date not null default date_trunc('month',now() at time zone 'America/Sao_Paulo')::date,
 reserved_micro bigint not null default 0 check(reserved_micro>=0), spent_micro bigint not null default 0 check(spent_micro>=0));
insert into public.ai_budget_state(singleton) values(true);
create table public.ai_budget_operations(operation_id uuid primary key,campaign_id uuid not null references public.campaigns(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,reserve_micro bigint not null check(reserve_micro>0),month_start date not null,actual_micro bigint,
 input_tokens integer,output_tokens integer,status text not null check(status in('reserved','dispatched','uncertain','settled','cancelled')),
 lease_until timestamptz not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.ai_budget_rate_events(operation_id uuid primary key,campaign_id uuid not null references public.campaigns(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now());
create index ai_budget_rate_user_time_idx on public.ai_budget_rate_events(user_id,created_at desc);
create index ai_budget_active_leases_idx on public.ai_budget_operations(lease_until,campaign_id) where status in('reserved','dispatched');
alter table public.ai_budget_state enable row level security; alter table public.ai_budget_operations enable row level security; alter table public.ai_budget_rate_events enable row level security;
revoke all on public.ai_budget_state,public.ai_budget_operations,public.ai_budget_rate_events from public,anon,authenticated;
grant all on public.ai_budget_state,public.ai_budget_operations,public.ai_budget_rate_events to service_role;

create or replace function public.ai_budget_reserve(p_campaign_id uuid,p_user_id uuid,p_operation_id uuid,p_reserve_micro bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare s public.ai_budget_state%rowtype; t timestamptz:=now(); m date;
begin
 if p_reserve_micro is null or p_reserve_micro<=0 or p_reserve_micro>30000000 then return jsonb_build_object('admitted',false,'reason','budget'); end if;
 if not exists(select 1 from public.campaigns where id=p_campaign_id) or not exists(select 1 from auth.users where id=p_user_id) then return jsonb_build_object('admitted',false,'reason','scope'); end if;
 select * into s from public.ai_budget_state where singleton for update;
 m:=date_trunc('month',t at time zone 'America/Sao_Paulo')::date;
 if s.month_start<>m then update public.ai_budget_state set month_start=m,reserved_micro=0,spent_micro=0 where singleton returning * into s; end if;
 if exists(select 1 from public.ai_budget_operations where operation_id=p_operation_id) then return jsonb_build_object('admitted',false,'reason','duplicate'); end if;
 if (select count(*) from public.ai_budget_operations where status in('reserved','dispatched') and lease_until>t)>=2
   or (select count(*) from public.ai_budget_operations where status in('reserved','dispatched') and lease_until>t and campaign_id=p_campaign_id)>=1
 then return jsonb_build_object('admitted',false,'reason','busy'); end if;
 if (select count(*) from public.ai_budget_rate_events where user_id=p_user_id and created_at>t-interval '60 seconds')>=2 then return jsonb_build_object('admitted',false,'reason','rate'); end if;
 if s.reserved_micro+s.spent_micro+p_reserve_micro>30000000 then return jsonb_build_object('admitted',false,'reason','budget'); end if;
 insert into public.ai_budget_operations(operation_id,campaign_id,user_id,reserve_micro,month_start,actual_micro,input_tokens,output_tokens,status,lease_until,created_at,updated_at) values(p_operation_id,p_campaign_id,p_user_id,p_reserve_micro,m,null,null,null,'reserved',t+interval '120 seconds',t,t);
 insert into public.ai_budget_rate_events values(p_operation_id,p_campaign_id,p_user_id,t);
 update public.ai_budget_state set reserved_micro=reserved_micro+p_reserve_micro where singleton;
 return jsonb_build_object('admitted',true,'reason','ok');
end $$;
create or replace function public.ai_budget_dispatch(p_operation_id uuid) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin update public.ai_budget_operations set status='dispatched',lease_until=now()+interval '120 seconds',updated_at=now() where operation_id=p_operation_id and status='reserved' and lease_until>now(); return found; end $$;
create or replace function public.ai_budget_settle(p_operation_id uuid,p_actual_micro bigint,p_input_tokens integer,p_output_tokens integer)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare op public.ai_budget_operations%rowtype;
begin
 perform 1 from public.ai_budget_state where singleton for update;
 select * into op from public.ai_budget_operations where operation_id=p_operation_id for update;
 if not found or op.status not in('dispatched','uncertain') or p_actual_micro is null or p_actual_micro<0 or p_actual_micro>op.reserve_micro or p_input_tokens is null or p_input_tokens<0 or p_output_tokens is null or p_output_tokens<0 then return false; end if;
 update public.ai_budget_state set reserved_micro=greatest(0,reserved_micro-op.reserve_micro),spent_micro=spent_micro+p_actual_micro where singleton and month_start=op.month_start;
 update public.ai_budget_operations set actual_micro=p_actual_micro,input_tokens=p_input_tokens,output_tokens=p_output_tokens,status='settled',updated_at=now() where operation_id=p_operation_id;
 return true;
end $$;
create or replace function public.ai_budget_cancel(p_operation_id uuid) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare op public.ai_budget_operations%rowtype;
begin perform 1 from public.ai_budget_state where singleton for update;
 select * into op from public.ai_budget_operations where operation_id=p_operation_id for update; if not found or op.status<>'reserved' then return false; end if;
 update public.ai_budget_state set reserved_micro=greatest(0,reserved_micro-op.reserve_micro) where singleton and month_start=op.month_start;
 update public.ai_budget_operations set status='cancelled',updated_at=now() where operation_id=p_operation_id; return true; end $$;
create or replace function public.ai_budget_uncertain(p_operation_id uuid) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin update public.ai_budget_operations set status='uncertain',lease_until=now(),updated_at=now() where operation_id=p_operation_id and status='dispatched'; return found; end $$;

create or replace function public.ai_approve_proposal(p_campaign_id uuid,p_request_id uuid,p_expected_version integer,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,auth as $$
declare r public.ai_requests%rowtype; sh public.character_sheets%rowtype; prep public.ai_private_preparations%rowtype; body_data jsonb; approved_template public.system_templates%rowtype; original_template jsonb;
begin
 if not private.can_manage_campaign(p_campaign_id) then raise exception using errcode='42501',message='manager role required'; end if;
 select * into r from public.ai_requests where id=p_request_id and campaign_id=p_campaign_id for update;
 if not found then raise exception using errcode='P0002',message='proposal not found'; end if;
 if r.status='approved' and r.destination_id is not null then return jsonb_build_object('request',to_jsonb(r),'destination_id',r.destination_id); end if;
 if r.status<>'pending' or r.version<>p_expected_version then raise exception using errcode='PT409',message='proposal version conflict'; end if;
 if jsonb_typeof(p_result)<>'object' or pg_column_size(p_result)>65536 then raise exception using errcode='22023',message='invalid proposal result'; end if;
 if r.kind='sheet' then
  if not(p_result ?& array['name','values']) or jsonb_typeof(p_result->'values')<>'object' then raise exception using errcode='22023',message='invalid sheet result'; end if;
  select * into approved_template from public.system_templates where id=r.template_id and campaign_id=p_campaign_id and status='approved' for share;
  if not found then raise exception using errcode='23514',message='approved campaign template required'; end if;
  select template_snapshot into original_template from public.ai_proposal_contents where request_id=r.id and campaign_id=p_campaign_id;
  if original_template is distinct from jsonb_build_object('id',approved_template.id,'name',approved_template.name,'version',approved_template.version,'schema',approved_template.schema) then raise exception using errcode='PT409',message='approved template changed'; end if;
  if r.target_id is null then
   insert into public.character_sheets(campaign_id,template_id,owner_id,name,values) values(p_campaign_id,r.template_id,r.author_id,p_result->>'name',p_result->'values') returning * into sh;
   r.destination_id:=sh.id;
  else
   select * into sh from public.character_sheets where id=r.target_id and campaign_id=p_campaign_id and owner_id=r.author_id for update;
   if not found or r.target_version is null or sh.version<>r.target_version or sh.template_id<>r.template_id then raise exception using errcode='PT409',message='sheet version or template conflict'; end if;
   update public.character_sheets set name=p_result->>'name',values=p_result->'values' where id=sh.id returning * into sh;
   r.destination_id:=sh.id;
  end if;
 else
  if r.kind not in('session','npc') then raise exception using errcode='22023',message='unsupported proposal kind'; end if;
  if r.kind='session' and (not(p_result ? 'title') or jsonb_typeof(p_result->'title')<>'string') then raise exception using errcode='22023',message='session title required'; end if;
  if r.kind='npc' and not(p_result ? 'name' or p_result ? 'title') then raise exception using errcode='22023',message='NPC name required'; end if;
  if r.kind='npc' and exists(select 1 from jsonb_object_keys(p_result) as x(key) where x.key not in('name','description','motivation','voice','hook','secret','relationships','questions')) then raise exception using errcode='22023',message='NPC proposals may contain narrative traits only'; end if;
  if r.kind='session' and exists(select 1 from jsonb_object_keys(p_result) as x(key) where x.key not in('title','summary','scenes','questions')) then raise exception using errcode='22023',message='invalid session fields'; end if;
  body_data:=p_result;
  insert into public.ai_private_preparations(campaign_id,request_id,kind,target_id,target_version,title,body)
    values(p_campaign_id,r.id,r.kind,r.target_id,r.target_version,coalesce(p_result->>'title',p_result->>'name'),body_data) returning * into prep;
  r.destination_id:=prep.id;
 end if;
 update public.ai_proposal_contents set result=p_result where request_id=r.id and campaign_id=p_campaign_id;
 update public.ai_requests set status='approved',destination_id=r.destination_id,version=version+1,updated_at=now() where id=r.id returning * into r;
 return jsonb_build_object('request',to_jsonb(r),'destination_id',r.destination_id);
end $$;

create or replace function public.ai_reject_proposal(p_campaign_id uuid,p_request_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,auth as $$
declare r public.ai_requests%rowtype;
begin if not private.can_manage_campaign(p_campaign_id) then raise exception using errcode='42501',message='manager role required'; end if;
 select * into r from public.ai_requests where id=p_request_id and campaign_id=p_campaign_id for update; if not found then raise exception using errcode='P0002',message='proposal not found'; end if;
 if r.status='rejected' and r.version=p_expected_version+1 then return jsonb_build_object('request',to_jsonb(r)); end if;
 if r.status<>'pending' or r.version<>p_expected_version then raise exception using errcode='PT409',message='proposal version conflict'; end if;
 update public.ai_requests set status='rejected',version=version+1,updated_at=now() where id=r.id returning * into r; return jsonb_build_object('request',to_jsonb(r)); end $$;

create or replace function public.ai_publish_preparation(p_campaign_id uuid,p_preparation_id uuid,p_expected_version integer,p_fields jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,auth as $$
declare p public.ai_private_preparations%rowtype; sid uuid; session_version bigint; e public.world_entities%rowtype; rel jsonb; field_key text; field_value jsonb;
begin
 if not private.can_manage_campaign(p_campaign_id) then raise exception using errcode='42501',message='manager role required'; end if;
 select * into p from public.ai_private_preparations where id=p_preparation_id and campaign_id=p_campaign_id for update;
 if not found then raise exception using errcode='P0002',message='preparation not found'; end if;
 if p.version<>p_expected_version then raise exception using errcode='PT409',message='preparation version conflict'; end if;
 if jsonb_typeof(p_fields)<>'object' or pg_column_size(p_fields)>65536 then raise exception using errcode='22023',message='publication must be a bounded object'; end if;
 for field_key,field_value in select key,value from jsonb_each(p_fields) loop
  if field_key<>'relationships' and (jsonb_typeof(field_value) is distinct from 'string' or char_length(field_value#>>'{}')>12000) then raise exception using errcode='22023',message='publication fields must be bounded text'; end if;
 end loop;
 if p.kind='session' then
  if p_fields='{}' or exists(select 1 from jsonb_object_keys(p_fields) as x(key) where x.key not in('title','summary')) then raise exception using errcode='22023',message='invalid session fields'; end if;
  perform 1 from public.campaigns where id=p_campaign_id for update;
  if p.target_id is null then
   if not(p_fields?'title') then raise exception using errcode='22023',message='select an explicit public session title'; end if;
   insert into public.campaign_sessions(campaign_id,sequence,title,summary) values(p_campaign_id,(select coalesce(max(sequence),0)+1 from public.campaign_sessions where campaign_id=p_campaign_id),p_fields->>'title',coalesce(p_fields->>'summary','')) returning id,sync_version into sid,session_version;
  else
   update public.campaign_sessions set title=coalesce(p_fields->>'title',title),summary=coalesce(p_fields->>'summary',summary) where id=p.target_id and campaign_id=p_campaign_id and sync_version=p.target_version returning id,sync_version into sid,session_version;
   if not found then raise exception using errcode='PT409',message='session destination changed'; end if;
  end if;
  update public.ai_private_preparations set target_id=sid,target_version=session_version,version=version+1,updated_at=now() where id=p.id;
  return jsonb_build_object('destination_id',sid,'kind','session');
 elsif p.kind='npc' then
  if p_fields='{}' or exists(select 1 from jsonb_object_keys(p_fields) as x(key) where x.key not in('name','description','motivation','voice','hook','relationships')) then raise exception using errcode='22023',message='invalid NPC fields'; end if;
  if p.target_id is null then
   if not(p_fields?'name') then raise exception using errcode='22023',message='select an explicit public NPC name'; end if;
   insert into public.world_entities(campaign_id,kind,name,body,created_by) values(p_campaign_id,'npc',p_fields->>'name',(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_fields) where key in('description','motivation','voice','hook')),auth.uid()) returning * into e;
  else
   select * into e from public.world_entities where id=p.target_id and campaign_id=p_campaign_id and kind='npc' for update;
   if not found or p.target_version is null or e.version is distinct from p.target_version then raise exception using errcode='PT409',message='NPC version conflict'; end if;
   update public.world_entities set name=coalesce(p_fields->>'name',name),body=body||(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_fields) where key in('description','motivation','voice','hook')) where id=e.id returning * into e;
  end if;
  if p_fields ? 'relationships' then
   if jsonb_typeof(p_fields->'relationships')<>'array' or jsonb_array_length(p_fields->'relationships')>20 then raise exception using errcode='22023',message='relationships must be a bounded array'; end if;
   for rel in select value from jsonb_array_elements(p_fields->'relationships') loop
    if jsonb_typeof(rel)<>'object' or not(rel?'target_id') or not(rel?'relation_type') or exists(select 1 from jsonb_object_keys(rel) as x(key) where x.key not in('target_id','relation_type','notes')) or not exists(select 1 from public.world_entities where id=(rel->>'target_id')::uuid and campaign_id=p_campaign_id) then raise exception using errcode='22023',message='invalid NPC relationship'; end if;
    insert into public.world_relations(campaign_id,from_entity_id,to_entity_id,relation_type,notes,created_by) values(p_campaign_id,e.id,(rel->>'target_id')::uuid,rel->>'relation_type',coalesce(rel->>'notes',''),auth.uid()) on conflict(from_entity_id,to_entity_id,relation_type) do nothing;
   end loop;
  end if;
  update public.ai_private_preparations set target_id=e.id,target_version=e.version,version=version+1,updated_at=now() where id=p.id;
  return jsonb_build_object('destination_id',e.id,'kind','npc');
 end if;
 raise exception using errcode='22023',message='unsupported preparation kind';
end $$;
revoke all on function public.ai_budget_reserve(uuid,uuid,uuid,bigint),public.ai_budget_dispatch(uuid),public.ai_budget_settle(uuid,bigint,integer,integer),public.ai_budget_cancel(uuid),public.ai_budget_uncertain(uuid) from public,anon,authenticated;
grant execute on function public.ai_budget_reserve(uuid,uuid,uuid,bigint),public.ai_budget_dispatch(uuid),public.ai_budget_settle(uuid,bigint,integer,integer),public.ai_budget_cancel(uuid),public.ai_budget_uncertain(uuid) to service_role;
create function public.ai_recover_stale(p_campaign_id uuid) returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare op public.ai_budget_operations%rowtype; affected integer;
begin
 perform 1 from public.ai_budget_state where singleton for update;
 for op in select * from public.ai_budget_operations where campaign_id=p_campaign_id and status in('reserved','dispatched') and lease_until<=now() for update loop
  if op.status='reserved' then
   update public.ai_budget_state set reserved_micro=greatest(0,reserved_micro-op.reserve_micro) where singleton and month_start=op.month_start;
   update public.ai_budget_operations set status='cancelled',updated_at=now() where operation_id=op.operation_id;
  else
   update public.ai_budget_operations set status='uncertain',updated_at=now() where operation_id=op.operation_id;
  end if;
 end loop;
 update public.ai_requests set status='failed' where campaign_id=p_campaign_id and status='generating' and updated_at<now()-interval '120 seconds';
 get diagnostics affected=row_count; return affected;
end $$;
revoke all on function public.ai_recover_stale(uuid) from public,anon,authenticated;
grant execute on function public.ai_recover_stale(uuid) to service_role;
revoke all on function public.ai_approve_proposal(uuid,uuid,integer,jsonb),public.ai_reject_proposal(uuid,uuid,integer),public.ai_publish_preparation(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.ai_approve_proposal(uuid,uuid,integer,jsonb),public.ai_reject_proposal(uuid,uuid,integer),public.ai_publish_preparation(uuid,uuid,integer,jsonb) to authenticated;















