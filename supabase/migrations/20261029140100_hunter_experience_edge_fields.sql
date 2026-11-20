-- F4 x F5: the Hunter starter (v4) keeps Edges in `triunfos` and Perks in `distincoes`
-- (frontend/lib/system-starters.ts). 20261029140000_experience_advances.sql mapped the placeholder
-- ids `edges` and `perks`; this points the Edge and Perk categories at the real collections.
delete from public.experience_trait_categories
 where system_key = 'hunter' and field_id in ('edges', 'perks', 'triunfos', 'distincoes');
insert into public.experience_trait_categories (system_key, field_id, category)
select 'hunter', field_id, category from (values ('triunfos', 'edge'), ('distincoes', 'perk')) as f(field_id, category);
