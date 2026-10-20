-- Ten fixed lease rows keep every admission attempt bounded and non-queuing.
create table if not exists private.api_concurrency_leases (
  slot_id smallint primary key check (slot_id between 1 and 10),
  lease_token uuid unique,
  expires_at timestamptz,
  check ((lease_token is null) = (expires_at is null))
);

insert into private.api_concurrency_leases (slot_id)
select generate_series(1, 10)::smallint
on conflict (slot_id) do nothing;

alter table private.api_concurrency_leases enable row level security;
revoke all on table private.api_concurrency_leases from public, anon, authenticated, service_role;

create or replace function public.api_concurrency_acquire(p_lease_token uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  admitted boolean;
begin
  if p_lease_token is null then
    raise exception 'lease token required' using errcode = '22023';
  end if;

  with available_slot as (
    select slot_id
      from private.api_concurrency_leases
     where lease_token is null or expires_at <= clock_timestamp()
     order by slot_id
     limit 1
     for update skip locked
  )
  update private.api_concurrency_leases as lease
     set lease_token = p_lease_token,
         expires_at = clock_timestamp() + interval '120 seconds'
    from available_slot
   where lease.slot_id = available_slot.slot_id
  returning true into admitted;

  return coalesce(admitted, false);
end;
$$;

create or replace function public.api_concurrency_release(p_lease_token uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  released boolean;
begin
  if p_lease_token is null then
    raise exception 'lease token required' using errcode = '22023';
  end if;

  update private.api_concurrency_leases
     set lease_token = null,
         expires_at = null
   where lease_token = p_lease_token
  returning true into released;
  return coalesce(released, false);
end;
$$;

revoke all on function public.api_concurrency_acquire(uuid) from public, anon, authenticated;
revoke all on function public.api_concurrency_release(uuid) from public, anon, authenticated;
grant execute on function public.api_concurrency_acquire(uuid) to service_role;
grant execute on function public.api_concurrency_release(uuid) to service_role;
