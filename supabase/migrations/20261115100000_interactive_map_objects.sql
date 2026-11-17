-- Interactive map props keep secret configuration outside maps.document.
create table public.map_interactive_objects (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  element_id text not null check (char_length(element_id) between 1 and 64),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  updated_at timestamptz not null default now(),
  unique (map_id, element_id),
  unique (id, map_id, campaign_id)
);

create table public.map_action_requests (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  object_id uuid not null,
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  action text not null check (action in ('open','close','examine','take','travel')),
  item_id text,
  quantity integer not null default 1 check (quantity between 1 and 100000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','stale')),
  note text not null default '' check (char_length(note) <= 1000),
  result jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  unique (requester_id, operation_id)
);
create index map_action_requests_campaign_pending_idx on public.map_action_requests(campaign_id,created_at) where status='pending';
alter table public.map_interactive_objects enable row level security;
alter table public.map_action_requests enable row level security;
revoke all on public.map_interactive_objects,public.map_action_requests from public,anon,authenticated;
grant select on public.map_interactive_objects,public.map_action_requests to authenticated;
create policy map_interactive_objects_gm_read on public.map_interactive_objects for select to authenticated using (private.can_manage_campaign(campaign_id));
create policy map_action_requests_private_read on public.map_action_requests for select to authenticated
 using (requester_id=auth.uid() or private.can_manage_campaign(campaign_id));

create or replace function private.map_action_valid(p_map public.maps,p_object public.map_interactive_objects,p_sheet uuid,p_actor uuid,p_action text,p_item text,p_quantity integer)
returns text language plpgsql stable security definer set search_path=pg_catalog,public,private,auth as $$
declare cfg jsonb:=p_object.config; kind text:=cfg->>'kind'; pin jsonb; prop jsonb; wall jsonb; distance float8; reach float8; target point; actor point; item jsonb; a point; b point; t float8; half_width float8; doc jsonb:=p_map.document;
begin
 if not private.is_campaign_member(p_map.campaign_id) then return 'campaign access denied'; end if;
 if not exists(select 1 from public.character_sheets s where s.id=p_sheet and s.campaign_id=p_map.campaign_id and s.owner_id=p_actor) then return 'own character required'; end if;
 select value into pin from jsonb_array_elements(doc->'pins') where value->>'kind'='character' and value->>'sheet_id'=p_sheet::text and not coalesce((value->>'gm_only')::boolean,false) limit 1;
 if pin is null then return 'character pin is not on this map'; end if;
 actor:=point((pin->>'x')::float8,(pin->>'y')::float8);
 select value into prop from jsonb_array_elements(doc->'structures') where value->>'id'=p_object.element_id;
 if prop is null or coalesce((prop->>'gm_only')::boolean,false) then return 'object is not present'; end if;
 if coalesce((doc->'fog'->>'enabled')::boolean,false) then
   if not private.map_structure_visible(prop,
     array(select private.map_jsonb_polygon(r->'points') from jsonb_array_elements(coalesce(doc->'fog'->'regions','[]'::jsonb)) r where r->'players' is null or jsonb_typeof(r->'players')='null' or r->'players' ? auth.uid()::text),
     array(select r->>'mode'='reveal' from jsonb_array_elements(coalesce(doc->'fog'->'regions','[]'::jsonb)) r where r->'players' is null or jsonb_typeof(r->'players')='null' or r->'players' ? auth.uid()::text)) then return 'object is not revealed'; end if;
 end if;
 reach:=coalesce((cfg->>'reach_cells')::float8,1)*coalesce((doc->'grid'->>'size')::float8,100);
 target:=point((prop->>'x')::float8,(prop->>'y')::float8);
 if prop->>'type'='door' then
  select s into wall from jsonb_array_elements(doc->'structures') s where s->>'id'=prop->>'wall_id';
  a:=point((wall->'points'->0->>0)::float8,(wall->'points'->0->>1)::float8);
  b:=point((wall->'points'->1->>0)::float8,(wall->'points'->1->>1)::float8);
  half_width:=coalesce((prop->>'width')::float8,300)/2;
  t:=greatest(0,least(1,((actor[0]-a[0])*(b[0]-a[0])+(actor[1]-a[1])*(b[1]-a[1]))/nullif((b[0]-a[0])^2+(b[1]-a[1])^2,0)));
  t:=greatest((prop->>'at')::float8-half_width/greatest(1,a <-> b),least((prop->>'at')::float8+half_width/greatest(1,a <-> b),t));
  target:=point(a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]));
 end if;
 distance:=greatest(abs(actor[0]-target[0]),abs(actor[1]-target[1]));
 distance:=greatest(0,distance-coalesce((cfg->>'interaction_radius')::float8,0));
 if distance>reach then return 'object is out of reach'; end if;
 if kind='door' then
  if not private.map_sight_clear(doc || jsonb_build_object('structures',(select coalesce(jsonb_agg(s),'[]'::jsonb) from jsonb_array_elements(doc->'structures') s where s->>'id'<>prop->>'wall_id')),actor,target) then return 'another wall or closed door blocks access'; end if;
 elsif not private.map_sight_clear(doc,actor,target) then return 'a wall or closed door blocks access'; end if;
 if kind='door' then
   if prop->>'type'<>'door' or p_action not in ('open','close') then return 'invalid door action'; end if;
   if p_action='open' and prop->>'state'='open' then return 'door is already open'; end if;
   if p_action='close' and prop->>'state'<>'open' then return 'door is not open'; end if;
 elsif kind='container' and p_action in ('examine','take') then
   if p_action='take' then
     select value into item from jsonb_array_elements(coalesce(cfg->'items','[]'::jsonb)) where value->>'id'=p_item;
     if item is null or coalesce((item->>'quantity')::int,0)<p_quantity then return 'container stock changed'; end if;
   end if;
 elsif kind='clue' and p_action='examine' then null;
 elsif kind='passage' and p_action='travel' then
   if not exists(select 1 from public.maps m where m.id=(cfg->>'target_map_id')::uuid and m.campaign_id=p_map.campaign_id) then return 'passage destination changed'; end if;
 else return 'action does not match object';
 end if;
 return null;
end $$;
revoke all on function private.map_action_valid(public.maps,public.map_interactive_objects,uuid,uuid,text,text,integer) from public,anon,authenticated;

create or replace function public.save_map_object(p_map_id uuid,p_element_id text,p_config jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,auth as $$
declare m public.maps; oid uuid; kind text:=p_config->>'kind';
begin
 select * into m from public.maps where id=p_map_id for update;
 if not found or not private.can_manage_campaign(m.campaign_id) then raise exception 'narrator access required' using errcode='42501'; end if;
 if p_config is null or kind not in ('door','container','clue','passage') or coalesce((p_config->>'reach_cells')::numeric,1) not between 0 and 100 then raise exception 'invalid object configuration' using errcode='22023'; end if;
 if coalesce((p_config->>'interaction_radius')::numeric,0) not between 0 and 10000 then raise exception 'invalid interaction radius' using errcode='22023'; end if;
 if not exists(select 1 from jsonb_array_elements(m.document->'structures') s where s->>'id'=p_element_id and ((kind='door' and s->>'type'='door') or (kind<>'door' and s->>'type'='prop'))) then raise exception 'map element not found' using errcode='22023'; end if;
 if kind='container' and jsonb_typeof(p_config->'items') is distinct from 'array' then raise exception 'container items required' using errcode='22023'; end if;
 if kind='clue' and char_length(coalesce(p_config->>'clue_text',''))>10000 then raise exception 'clue text too long' using errcode='22023'; end if;
 if kind='passage' and not exists(select 1 from public.maps target where target.id=(p_config->>'target_map_id')::uuid and target.campaign_id=m.campaign_id) then raise exception 'passage destination must be in campaign' using errcode='22023'; end if;
 update public.map_action_requests set status='stale',note='object configuration changed',decided_at=now(),decided_by=auth.uid()
 where map_id=p_map_id and object_id=(select id from public.map_interactive_objects where map_id=p_map_id and element_id=p_element_id) and status='pending';
 insert into public.map_interactive_objects(map_id,campaign_id,element_id,config) values(p_map_id,m.campaign_id,p_element_id,p_config)
 on conflict(map_id,element_id) do update set config=excluded.config,updated_at=now() returning id into oid;
 return jsonb_build_object('id',oid,'element_id',p_element_id,'kind',kind);
end $$;
revoke all on function public.save_map_object(uuid,text,jsonb) from public,anon;
grant execute on function public.save_map_object(uuid,text,jsonb) to authenticated;

create or replace function public.get_map_objects(p_map_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private,auth as $$
declare m public.maps; out jsonb;
begin
 select * into m from public.maps where id=p_map_id;
 if not found or not private.is_campaign_member(m.campaign_id) then raise exception 'map access denied' using errcode='42501'; end if;
 if private.can_manage_campaign(m.campaign_id) then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'element_id',element_id,'kind',config->'kind','label',config->'label','reach_cells',config->'reach_cells','config',config)), '[]'::jsonb) into out from public.map_interactive_objects where map_id=p_map_id;
 else
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'element_id',o.element_id,'kind',o.config->'kind','label',o.config->'label','reach_cells',o.config->'reach_cells')), '[]'::jsonb) into out
   from public.map_interactive_objects o join lateral jsonb_array_elements(m.document->'structures') s on s->>'id'=o.element_id
   where o.map_id=p_map_id and not coalesce((s->>'gm_only')::boolean,false)
    and (not coalesce((m.document->'fog'->>'enabled')::boolean,false) or private.map_structure_visible(s,
      array(select private.map_jsonb_polygon(r->'points') from jsonb_array_elements(coalesce(m.document->'fog'->'regions','[]'::jsonb)) r where r->'players' is null or jsonb_typeof(r->'players')='null' or r->'players' ? auth.uid()::text),
      array(select r->>'mode'='reveal' from jsonb_array_elements(coalesce(m.document->'fog'->'regions','[]'::jsonb)) r where r->'players' is null or jsonb_typeof(r->'players')='null' or r->'players' ? auth.uid()::text)));
 end if;
 return out;
end $$;
revoke all on function public.get_map_objects(uuid) from public,anon;
grant execute on function public.get_map_objects(uuid) to authenticated;

create or replace function public.list_map_interaction_targets(p_map_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private,auth as $$
declare m public.maps; out jsonb;
begin
 select * into m from public.maps where id=p_map_id;
 if not found or not private.can_manage_campaign(m.campaign_id) then raise exception 'narrator access required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'width',document->'width','height',document->'height','grid_size',document->'grid'->'size') order by name),'[]'::jsonb) into out
 from public.maps where campaign_id=m.campaign_id and id<>m.id;
 return out;
end $$;
revoke all on function public.list_map_interaction_targets(uuid) from public,anon;
grant execute on function public.list_map_interaction_targets(uuid) to authenticated;

create or replace function public.delete_map_object(p_map_id uuid,p_object_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,private,auth as $$
declare m public.maps;
begin
 select * into m from public.maps where id=p_map_id for update;
 if not found or not private.can_manage_campaign(m.campaign_id) then raise exception 'narrator access required' using errcode='42501'; end if;
 update public.map_action_requests set status='stale',note='object configuration removed',decided_at=now(),decided_by=auth.uid()
 where object_id=p_object_id and map_id=p_map_id and status='pending';
 delete from public.map_interactive_objects where id=p_object_id and map_id=p_map_id;
 return found;
end $$;
revoke all on function public.delete_map_object(uuid,uuid) from public,anon;
grant execute on function public.delete_map_object(uuid,uuid) to authenticated;

create or replace function public.list_map_actions(p_map_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private,auth as $$
declare m public.maps; out jsonb;
begin
 select * into m from public.maps where id=p_map_id;
 if not found or not private.is_campaign_member(m.campaign_id) then raise exception 'map access denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'object_id',r.object_id,'sheet_id',r.sheet_id,'requester_id',r.requester_id,'action',r.action,'item_id',r.item_id,'quantity',r.quantity,'status',r.status,'note',r.note,'result',r.result,'created_at',r.created_at)), '[]'::jsonb) into out
 from public.map_action_requests r where r.map_id=p_map_id and (r.requester_id=auth.uid() or private.can_manage_campaign(r.campaign_id));
 return out;
end $$;
revoke all on function public.list_map_actions(uuid) from public,anon;
grant execute on function public.list_map_actions(uuid) to authenticated;

create or replace function public.request_map_action(p_map_id uuid,p_object_id uuid,p_sheet_id uuid,p_action text,p_operation_id uuid,p_item_id text default null,p_quantity integer default 1)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,auth as $$
declare m public.maps; o public.map_interactive_objects; err text; rid uuid; existing public.map_action_requests;
begin
 select * into m from public.maps where id=p_map_id for update;
 if not found or not m.shared_with_players or not private.is_campaign_member(m.campaign_id) then raise exception 'map access denied' using errcode='42501'; end if;
 select * into o from public.map_interactive_objects where id=p_object_id and map_id=p_map_id;
 if not found then raise exception 'object not found' using errcode='P0002'; end if;
 err:=private.map_action_valid(m,o,p_sheet_id,auth.uid(),p_action,p_item_id,p_quantity);
 if err is not null then raise exception '%',err using errcode='42501'; end if;
 select * into existing from public.map_action_requests where requester_id=auth.uid() and operation_id=p_operation_id;
 if found then return jsonb_build_object('id',existing.id,'status',existing.status); end if;
 insert into public.map_action_requests(map_id,campaign_id,object_id,sheet_id,requester_id,operation_id,action,item_id,quantity)
 values(p_map_id,m.campaign_id,p_object_id,p_sheet_id,auth.uid(),p_operation_id,p_action,p_item_id,p_quantity) returning id into rid;
 return jsonb_build_object('id',rid,'status','pending');
end $$;
revoke all on function public.request_map_action(uuid,uuid,uuid,text,uuid,text,integer) from public,anon;
grant execute on function public.request_map_action(uuid,uuid,uuid,text,uuid,text,integer) to authenticated;

create or replace function public.decide_map_action(p_request_id uuid,p_approve boolean,p_note text default '')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,auth as $$
declare r public.map_action_requests; m public.maps; o public.map_interactive_objects; err text; prop jsonb; idx integer; cfg jsonb; item jsonb; inv public.character_inventory; dst jsonb;
begin
 select * into r from public.map_action_requests where id=p_request_id;
 if not found or not private.can_manage_campaign(r.campaign_id) then raise exception 'narrator access required' using errcode='42501'; end if;
 select * into r from public.map_action_requests where id=p_request_id for update;
 if r.status<>'pending' then return jsonb_build_object('id',r.id,'status',r.status,'result',r.result); end if;
 select * into m from public.maps where id=r.map_id for update;
 select * into o from public.map_interactive_objects where id=r.object_id for update;
 if not p_approve then update public.map_action_requests set status='rejected',note=left(p_note,1000),decided_at=now(),decided_by=auth.uid() where id=r.id; return jsonb_build_object('id',r.id,'status','rejected'); end if;
 if not found then update public.map_action_requests set status='stale',note='object configuration removed',decided_at=now(),decided_by=auth.uid() where id=r.id; return jsonb_build_object('id',r.id,'status','stale','reason','object configuration removed'); end if;
 err:=private.map_action_valid(m,o,r.sheet_id,r.requester_id,r.action,r.item_id,r.quantity);
 if err is not null then update public.map_action_requests set status='stale',note=err,decided_at=now(),decided_by=auth.uid() where id=r.id; return jsonb_build_object('id',r.id,'status','stale','reason',err); end if;
 cfg:=o.config;
 if r.action in ('open','close') then
  select ordinality-1,value into idx,prop from jsonb_array_elements(m.document->'structures') with ordinality where value->>'id'=o.element_id;
  update public.maps set document=jsonb_set(document,array['structures',idx::text,'state'],to_jsonb(case when r.action='open' then 'open' else 'closed' end)) where id=m.id;
  update public.map_interactive_objects set config=jsonb_set(config,'{door_state}',to_jsonb(case when r.action='open' then 'open' else 'closed' end)) where id=o.id;
  dst:=jsonb_build_object('door_state',case when r.action='open' then 'open' else 'closed' end);
 elsif r.action='examine' and cfg->>'kind'='clue' then dst:=jsonb_build_object('clue_text',cfg->>'clue_text');
 elsif r.action='examine' and cfg->>'kind'='container' then dst:=jsonb_build_object('items',cfg->'items');
 elsif r.action='take' then
  select ordinality-1,value into idx,item from jsonb_array_elements(cfg->'items') with ordinality where value->>'id'=r.item_id;
  if item is null or (item->>'quantity')::int<r.quantity then err:='container stock changed';
  else
   cfg:=jsonb_set(cfg,array['items',idx::text,'quantity'],to_jsonb((item->>'quantity')::int-r.quantity));
   update public.map_interactive_objects set config=cfg where id=o.id;
   insert into public.character_inventory(sheet_id,campaign_id,name,category,quantity,acquired,notes)
   values(r.sheet_id,r.campaign_id,left(item->>'name',160),case when item->>'category' in ('weapon','armor','equipment','clothing','dwelling','vehicle','mount','animal') then item->>'category' else 'equipment' end,r.quantity,true,'Obtido de recipiente no mapa') returning * into inv;
   dst:=jsonb_build_object('inventory_item_id',inv.id,'name',inv.name,'quantity',r.quantity);
  end if;
 elsif r.action='travel' then
  select value into prop from jsonb_array_elements(m.document->'pins') where value->>'kind'='character' and value->>'sheet_id'=r.sheet_id::text limit 1;
  update public.maps set document=jsonb_set(document,'{pins}',coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements(document->'pins') with ordinality where value->>'sheet_id'<>r.sheet_id::text),'[]'::jsonb)) where id=m.id;
  update public.maps set document=jsonb_set(document,'{pins}',coalesce(document->'pins','[]'::jsonb)||jsonb_build_array(prop||jsonb_build_object('x',cfg->'target_x','y',cfg->'target_y'))) where id=(cfg->>'target_map_id')::uuid;
  dst:=jsonb_build_object('map_id',cfg->'target_map_id','x',cfg->'target_x','y',cfg->'target_y');
 end if;
 if err is not null then update public.map_action_requests set status='stale',note=err,decided_at=now(),decided_by=auth.uid() where id=r.id; return jsonb_build_object('id',r.id,'status','stale','reason',err); end if;
 update public.map_action_requests set status='approved',note=left(p_note,1000),result=dst,decided_at=now(),decided_by=auth.uid() where id=r.id;
 return jsonb_build_object('id',r.id,'status','approved','result',dst);
end $$;
revoke all on function public.decide_map_action(uuid,boolean,text) from public,anon;
grant execute on function public.decide_map_action(uuid,boolean,text) to authenticated;
