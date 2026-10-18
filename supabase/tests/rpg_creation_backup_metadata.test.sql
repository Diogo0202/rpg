begin;
select plan(14);

insert into auth.users (id, aud, role, email)
values ('11000000-0000-0000-0000-000000000021', 'authenticated', 'authenticated', 'backup-metadata@example.test');
insert into public.campaigns (id, owner_id, name)
values ('21000000-0000-0000-0000-000000000021', '11000000-0000-0000-0000-000000000021', 'Backup metadata campaign');
insert into public.system_templates (id, campaign_id, owner_id, name, status, schema)
values ('31000000-0000-0000-0000-000000000021', '21000000-0000-0000-0000-000000000021',
        '11000000-0000-0000-0000-000000000021', 'Guided template', 'approved',
        '{"system_key":"vampire","rules_profile_version":2,"fields":[{"id":"name","label":"Name","kind":"text","required":true,"options":[],"expression":null,"creation_step":"identity","identity_kind":"origin","character_name":true}]}'::jsonb);

select is(
  public.normalize_sheet_backup_fields('[{"id":"name","label":"Name","kind":"text","required":true,"options":[],"expression":null,"creation_step":"identity","identity_kind":"origin","character_name":true}]'::jsonb),
  '[{"id":"name","label":"Name","kind":"text","required":true,"options":[],"expression":null}]'::jsonb,
  'normalizer removes exactly the three presentation metadata keys'
);
select is(
  public.normalize_sheet_backup_fields('[{"id":"name","custom_rule":"keep","creation_step":"identity"}]'::jsonb),
  '[{"id":"name","custom_rule":"keep"}]'::jsonb,
  'normalizer preserves unknown properties'
);
select is(
  public.normalize_sheet_backup_fields('[{"id":"a"},{"id":"b"}]'::jsonb),
  '[{"id":"a"},{"id":"b"}]'::jsonb,
  'normalizer preserves array order'
);
select is(public.normalize_sheet_backup_fields('{"fields":[]}'::jsonb), null::jsonb, 'non-array input is rejected by the normalizer');
select ok(not (select prosecdef from pg_catalog.pg_proc where oid = 'public.normalize_sheet_backup_fields(jsonb)'::regprocedure), 'normalizer runs as invoker');
select ok((select provolatile = 'i' from pg_catalog.pg_proc where oid = 'public.normalize_sheet_backup_fields(jsonb)'::regprocedure), 'normalizer is immutable');
select ok(has_function_privilege('authenticated', 'public.normalize_sheet_backup_fields(jsonb)', 'execute'), 'authenticated restore callers can execute the normalizer');
select ok(not (select prosecdef from pg_catalog.pg_proc where oid = 'public.restore_character_backup(uuid,uuid,jsonb)'::regprocedure), 'restore remains security invoker');
select ok(not has_function_privilege('anon', 'public.restore_character_backup(uuid,uuid,jsonb)', 'execute'), 'anonymous callers cannot execute restore');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000021', true);
select is(
  (select owner_id from public.restore_character_backup(
    '21000000-0000-0000-0000-000000000021', '31000000-0000-0000-0000-000000000021',
    '{"format":"rpg-nexus-sheet","format_version":1,"name":"Lia","template":{"name":"Legacy model","version":1,"fields":[{"id":"name","label":"Name","kind":"text","required":true,"options":[],"expression":null}]},"values":{"name":"Lia"},"effects":[],"inventory":[]}'::jsonb
  )),
  '11000000-0000-0000-0000-000000000021'::uuid,
  'restore accepts v1 mechanics with approved-template presentation metadata and keeps caller as owner'
);
select throws_ok($$select public.restore_character_backup(
  '21000000-0000-0000-0000-000000000021', '31000000-0000-0000-0000-000000000021',
  '{"format":"rpg-nexus-sheet","format_version":1,"name":"Lia","template":{"name":"Legacy model","version":1,"fields":[{"id":"name","label":"Name","kind":"text","required":false,"options":[],"expression":null}]},"values":{"name":"Lia"},"effects":[],"inventory":[]}'::jsonb
)$$, 'P0001', 'an identical approved campaign template is required', 'restore rejects required mismatch');
select throws_ok($$select public.restore_character_backup(
  '21000000-0000-0000-0000-000000000021', '31000000-0000-0000-0000-000000000021',
  '{"format":"rpg-nexus-sheet","format_version":1,"name":"Lia","template":{"name":"Legacy model","version":1,"fields":[{"id":"name","label":"Name","kind":"text","required":true,"options":["Other"],"expression":null}]},"values":{"name":"Lia"},"effects":[],"inventory":[]}'::jsonb
)$$, 'P0001', 'an identical approved campaign template is required', 'restore rejects options mismatch');
select throws_ok($$select public.restore_character_backup(
  '21000000-0000-0000-0000-000000000021', '31000000-0000-0000-0000-000000000021',
  '{"format":"rpg-nexus-sheet","format_version":1,"name":"Lia","template":{"name":"Legacy model","version":1,"fields":[{"id":"name","label":"Name","kind":"text","required":true,"options":[],"expression":null,"unknown_security_flag":true}]},"values":{"name":"Lia"},"effects":[],"inventory":[]}'::jsonb
)$$, 'P0001', 'an identical approved campaign template is required', 'restore rejects unknown extra field properties');
select throws_ok($$select public.restore_character_backup(
  '21000000-0000-0000-0000-000000000021', '31000000-0000-0000-0000-000000000021',
  '{"format":"rpg-nexus-sheet","format_version":1,"name":"Lia","template":{"name":"Legacy model","version":1},"values":{"name":"Lia"},"effects":[],"inventory":[]}'::jsonb
)$$, 'P0001', 'an identical approved campaign template is required', 'restore rejects missing fields arrays');

select * from finish();
rollback;
