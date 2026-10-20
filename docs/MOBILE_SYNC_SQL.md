# Mobile sync SQL coverage

Migration `20261018200000_mobile_sync.sql` implements protocol v1 for the entity tables below. Each public RPC requires an authenticated JWT. `anon` and `service_role` have no execution grant, and the browser receives no service credential. Sync RPC calls run inside the caller's transaction; each domain write, incremented campaign revision, and private change event commit together.

## RPC signatures

```sql
public.mobile_sync_push(p_campaign_id uuid, p_device_id uuid, p_mutations jsonb) returns jsonb
public.mobile_sync_snapshot(p_campaign_id uuid, p_entity_type text, p_after_id uuid default null, p_limit integer default 100) returns jsonb
public.mobile_sync_changes(p_campaign_id uuid, p_cursor bigint, p_limit integer default 100) returns jsonb
```

Push accepts up to 50 operations. Each operation is limited to 32 KiB and 200 changes. Change paths contain 1 to 12 object keys; numeric keys, prototype keys, overlapping paths, and traversal through arrays or scalar JSON values are rejected. Limits for snapshot and changes are 1 to 500 rows. Entity names match table names exactly.

The response has `protocol_version: 1`. Push returns `{protocol_version,campaign_id,cursor,results}`; each result has `operation_id` and `status`, with `record`, `conflict_paths`, or a fixed `message` when applicable. Snapshot returns `{protocol_version,campaign_id,cursor,records,has_more,next_after_id}`. Changes returns `{protocol_version,campaign_id,cursor,has_more,changes}`; each event includes `revision`, `entity_type`, `entity_id`, `version`, and `action`, plus an authorized `record` or `tombstone: true`. The record wrapper is `{entity_type,entity_id,version,data}`; `data` is the RLS-visible row with `sync_version` removed. The wrapper's `version` is the SQL `sync_version`, separate from business/model `version` columns. Delete tombstones carry the deleted row's prior sync version plus one.

The server hashes the canonical JSONB operation and saves its outcome under user, campaign, device, and operation ID. A replay with the same hash returns the saved applied outcome as `duplicate`; saved conflicts, invalid operations, and denials retain their original status. A changed payload under an existing operation ID returns `invalid`. Dependencies may refer to successful receipts in an earlier batch. Deleted entity UUIDs cannot be reused.

If a sheet owner changes, the former owner receives a `delete` event with `tombstone: true` and no `record` for that sheet and each of its inventory rows. These events are tagged internally as visibility-only, so campaign managers do not remove rows they can still read. The new owner receives current sheet and inventory records through regular record-bearing change events. The transfer increments the affected inventory rows' domain and sync versions through their existing update triggers. Clients must treat the former owner's tombstones as removal from that account's cache even though the rows still exist for the new owner.

## Supported entities and writable fields

All fields below are the only client-writable root fields. Nested paths under JSON objects are accepted where their current JSON container is an object. The database applies its existing constraints, RLS, and business triggers after field validation.

| `entity_type` | Writable fields | Access and server rules |
| --- | --- | --- |
| `campaigns` | `name`, `description` | Bootstrap create must be the only mutation and use `entity_id = p_campaign_id`. SQL sets `owner_id` to the JWT user. Existing campaign RLS controls edits and deletes. |
| `system_templates` | `name`, `schema`, `page_references` | Create sets actor ownership and `needs_review`; edits and deletes apply only to `needs_review` drafts. Approved templates stay immutable. `source_id`, status, approval fields and model version are server controlled. |
| `character_sheets` | `template_id`, `name`, `values` | Create requires a campaign-approved template with a valid field schema and rejects non-null `rules_profile_version`; it sets owner to the JWT user and runs the existing sheet validators. The trimmed name is copied into the configured text character-name field (or `nome` fallback). Formula and roll inputs are stripped. |
| `character_inventory` | `sheet_id`, `name`, `category`, `quantity`, `resource_cost`, `damage_bonus`, `protection`, `notes`, `acquired`, `equipped`, `sort_order` | Existing sheet ownership and inventory RLS policies apply. `campaign_id`, model `version` and timestamps are server controlled. |
| `world_entities` | `kind`, `name`, `body` | SQL sets `created_by` to the JWT user. |
| `world_relations` | `from_entity_id`, `to_entity_id`, `relation_type`, `notes` | SQL sets `created_by`; foreign keys and same-campaign constraints remain active. |
| `maps` | `name`, `document`, `grid_kind`, `isometric` | Existing map RLS applies; currently manager-only. |
| `map_pins` | `map_id`, `entity_id`, `x`, `y`, `label` | Existing map RLS applies; currently manager-only. Existing UUID `id` is retained. `campaign_id` is derived from the map and guarded against scope changes. |
| `campaign_sessions` | `sequence`, `title`, `summary`, `status`, `played_on` | Existing manager policies, unique sequence, and validation constraints remain active. |
| `campaign_factions` | `name`, `description`, `goal`, `tension`, `limit`, `consequence` | Existing manager policies and range constraints remain active. |
| `campaign_events` | `session_id`, `faction_id`, `title`, `description`, `occurred_on`, `status` | Existing manager policies and same-campaign foreign keys remain active. |
| `combat_sessions` | `map_id`, `title`, `state`, `active` | Existing table RLS applies. Combat events are not included. |

Every supported table has an independent `sync_version`, initially 1 and incremented by a trigger for both RPC and legacy writes. A private trigger records legacy insert/update/delete events too. Campaign revisions are serialized by updating one per-campaign head row; concurrent writers may wait or encounter a transaction retry/deadlock, which callers should retry using the same operation ID and payload.

## Authorization and boundaries

`sync_devices`, `campaign_sync_state`, `sync_changes`, and `mutation_receipts` live in the private schema, have RLS enabled, and have no direct grants to client roles. The changes RPC reads the private log only after checking campaign membership, filters sheet and inventory history against current ownership, and exposes map events only to managers. Hidden events still advance the cursor without returning their IDs. Duplicate push results re-read records under current RLS before returning data, so a cached receipt cannot restore access after ownership changes.

The initial allowlist does not include music, Second Inquisition, chronicle/dramatic engine tables, `combat_events`, or any table absent from the table above. The client must not mark these types as server-synced. Receipts have no cleanup policy yet, so they remain stored to preserve replay safety. A cursor older than retained change history is not currently detected because the migration does not prune history; clients should follow the API's full-snapshot recovery behavior when requested.

## Verification evidence

`node scripts/test-db.mjs --test mobile_sync` applies the migration sequence to local PGlite Postgres WASM with Auth fixtures and runs the SQL pgTAP file. The focused suite covers 50 assertions for grants, private-table access, two campaign users plus an outsider, campaign bootstrap ownership, idempotent replay and changed hashes, merge/conflict behavior and record DTOs, owner-field rejection, draft schema validation and approved-template denial, unsupported rules profiles on sheet create/update, legacy-write revisions, map-pin scope, delete and owner-transfer tombstones, transferred sheet/inventory visibility, array-path rejection, and RLS-filtered snapshot/change reads. This proves local migration and test behavior only; it does not apply the migration to Supabase or verify the remote project's RLS state.
