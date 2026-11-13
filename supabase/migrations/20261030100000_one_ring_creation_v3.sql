create or replace function private.one_ring_catalog() returns jsonb language sql immutable set search_path=pg_catalog as $catalog$ select $json${"version":3,"source":{"id":"1IncmiLhV10vXg7mJZa4b29jYfSx9NFoi","title":"O Um Anel 2ª edição, tradução brasileira beta 2.1","pdf_page_offset":3,"pages":{"creation":[28,55],"equipment":[47,50,100],"virtues":80,"rewards":79,"living":72},"precedence":"Descrições completas dos capítulos prevalecem sobre o resumo da página 51."},"attributes":["corpo","coracao","astucia"],"skills":[{"id":"awe","label":"Fascínio","legacy_label":"Presença","attribute":"corpo"},{"id":"enhearten","label":"Indução","legacy_label":"Encorajar","attribute":"coracao"},{"id":"persuade","label":"Persuasão","legacy_label":"Persuasão","attribute":"astucia"},{"id":"athletics","label":"Atletismo","legacy_label":"Atletismo","attribute":"corpo"},{"id":"travel","label":"Viagem","legacy_label":"Viagem","attribute":"coracao"},{"id":"stealth","label":"Furtividade","legacy_label":"Furtividade","attribute":"astucia"},{"id":"awareness","label":"Vigilância","legacy_label":"Percepção","attribute":"corpo"},{"id":"insight","label":"Discernimento","legacy_label":"Intuição","attribute":"coracao"},{"id":"scan","label":"Busca","legacy_label":"Busca","attribute":"astucia"},{"id":"hunting","label":"Caçada","legacy_label":"Caçada","attribute":"corpo"},{"id":"healing","label":"Cura","legacy_label":"Cura","attribute":"coracao"},{"id":"explore","label":"Exploração","legacy_label":"Exploração","attribute":"astucia"},{"id":"song","label":"Música","legacy_label":"Canção","attribute":"corpo"},{"id":"courtesy","label":"Cortesia","legacy_label":"Cortesia","attribute":"coracao"},{"id":"riddle","label":"Enigma","legacy_label":"Enigmas","attribute":"astucia"},{"id":"craft","label":"Ofício","legacy_label":"Ofício","attribute":"corpo"},{"id":"battle","label":"Batalha","legacy_label":"Batalha","attribute":"coracao"},{"id":"lore","label":"História","legacy_label":"Conhecimento","attribute":"astucia"}],"proficiencies":[{"id":"machados","label":"Machados"},{"id":"arcos","label":"Arcos"},{"id":"lancas","label":"Lanças"},{"id":"espadas","label":"Espadas"}],"skill_costs":[0,1,2,3,5],"combat_costs":[0,2,4,6],"previous_experience":10,"cultures":[{"id":"dwarves","name":"Anões do Povo de Durin","attributes":[[7,2,5],[7,3,4],[6,3,5],[6,4,4],[5,4,5],[6,2,6]],"bases":[22,8,10],"skills":{"awe":2,"enhearten":0,"persuade":0,"athletics":1,"travel":3,"stealth":0,"awareness":0,"insight":0,"scan":3,"hunting":0,"healing":0,"explore":2,"song":1,"courtesy":1,"riddle":2,"craft":2,"battle":1,"lore":1},"favoured":["travel","craft"],"combat":["machados","espadas"],"traits":["Astuto","Cauteloso","Feroz","Nobre","Orgulhoso","Severo","Sigiloso","Teimoso"],"living":"Próspero","languages":["Língua Comum","Khuzdul"],"blessing":"Formidável","page":32,"armor_load_divisor":2,"forbidden_equipment":["great_bow","long_spear","great_shield"],"age_suggestion":[50,90]},{"id":"bardings","name":"Bardeses","attributes":[[5,7,2],[4,7,3],[5,6,3],[4,6,4],[5,5,4],[6,6,2]],"bases":[20,8,12],"skills":{"awe":1,"enhearten":2,"persuade":3,"athletics":1,"travel":1,"stealth":0,"awareness":0,"insight":2,"scan":1,"hunting":2,"healing":0,"explore":1,"song":1,"courtesy":2,"riddle":0,"craft":1,"battle":2,"lore":1},"favoured":["enhearten","athletics"],"combat":["arcos","espadas"],"traits":["Alto","Ansioso","Belo","Bravo","Feroz","Generoso","Orgulhoso","Teimoso"],"living":"Próspero","languages":["Língua Comum","Valeanto"],"blessing":"Coração Forte","page":34,"valour_favoured":true,"age_suggestion":[18,40]},{"id":"elves","name":"Elfos de Lindon","attributes":[[5,2,7],[4,3,7],[5,3,6],[4,4,6],[5,4,5],[6,2,6]],"bases":[20,8,12],"skills":{"awe":2,"enhearten":1,"persuade":0,"athletics":2,"travel":0,"stealth":3,"awareness":2,"insight":0,"scan":0,"hunting":0,"healing":1,"explore":0,"song":2,"courtesy":0,"riddle":0,"craft":2,"battle":0,"lore":3},"favoured":["song","lore"],"combat":["arcos","lancas"],"traits":["Ágil","Alegre","Belo","Cauteloso","Nobre","Olhar Aguçado","Paciente","Sutil"],"living":"Frugal","languages":["Língua Comum","Sindarin"],"blessing":"Perícia Élfica","page":36,"age_suggestion":[100,300]},{"id":"hobbits","name":"Hobbits do Condado","attributes":[[3,6,5],[3,7,4],[2,7,5],[4,6,4],[4,5,5],[2,6,6]],"bases":[18,10,12],"skills":{"awe":0,"enhearten":0,"persuade":2,"athletics":0,"travel":0,"stealth":3,"awareness":2,"insight":2,"scan":0,"hunting":0,"healing":1,"explore":0,"song":2,"courtesy":2,"riddle":3,"craft":1,"battle":0,"lore":0},"favoured":["stealth","courtesy"],"combat":["arcos","espadas"],"traits":["Alegre","Ansioso","Eloquente","Fiel","Honrado","Inquisitivo","Olhar Aguçado","Rústico"],"living":"Comum","languages":["Língua Comum"],"blessing":"Bom-senso Hobbit","page":38,"wisdom_favoured":true,"greed_bonus":1,"allowed_weapons":["dagger","bow","club","short_sword","short_spear","spear","axe","cudgel"],"forbidden_equipment":["great_shield"],"age_suggestion":[20,60]},{"id":"bree","name":"Homens de Bri","attributes":[[2,5,7],[3,4,7],[3,5,6],[4,4,6],[4,5,5],[2,6,6]],"bases":[20,10,10],"skills":{"awe":0,"enhearten":2,"persuade":2,"athletics":1,"travel":1,"stealth":1,"awareness":1,"insight":2,"scan":1,"hunting":1,"healing":0,"explore":1,"song":1,"courtesy":3,"riddle":2,"craft":2,"battle":0,"lore":0},"favoured":["insight","riddle"],"combat":["machados","lancas"],"traits":["Astuto","Inquisitivo","Eloquente","Fiel","Generoso","Paciente","Rústico","Sincero"],"living":"Comum","languages":["Língua Comum"],"blessing":"Sangue de Bri","page":40,"fellowship_bonus":1,"age_suggestion":[18,40]},{"id":"rangers","name":"Patrulheiros do Norte","attributes":[[7,5,2],[7,4,3],[6,5,3],[6,4,4],[5,5,4],[6,6,2]],"bases":[20,6,14],"skills":{"awe":1,"enhearten":0,"persuade":0,"athletics":2,"travel":2,"stealth":2,"awareness":2,"insight":0,"scan":1,"hunting":2,"healing":2,"explore":2,"song":0,"courtesy":0,"riddle":0,"craft":0,"battle":2,"lore":2},"favoured":["hunting","lore"],"combat":["lancas","espadas"],"traits":["Ágil","Alto","Bravo","Honrado","Severo","Sigiloso","Sincero","Sutil"],"living":"Frugal","languages":["Língua Comum","Sindarin"],"blessing":"Reis dos Homens","page":42,"attribute_bonus":1,"age_suggestion":[20,50]}],"callings":[{"id":"treasure_hunter","name":"Caçador de Tesouros","favoured":["explore","scan","stealth"],"trait":"Ladroagem","shadow":"Doença do Dragão","page":44},{"id":"champion","name":"Campeão","favoured":["athletics","awe","hunting"],"trait":"Conhecimento sobre Inimigos","shadow":"Maldição da Vingança","enemy_choice":true,"page":44},{"id":"captain","name":"Capitão","favoured":["battle","enhearten","persuade"],"trait":"Liderança","shadow":"Tentação do Poder","page":45},{"id":"scholar","name":"Erudito","favoured":["craft","lore","riddle"],"trait":"Rimas de História","shadow":"Tentação dos Segredos","page":45},{"id":"warden","name":"Guardião","favoured":["awareness","healing","insight"],"trait":"História da Sombra","shadow":"Caminho do Desespero","page":45},{"id":"messenger","name":"Mensageiro","favoured":["courtesy","song","travel"],"trait":"História dos Povos","shadow":"Loucura da Vagância","page":46}],"enemies":["Homens Malignos","Orcs","Aranhas","Trolls","Wargs","Mortos-vivos"],"living":[{"name":"Pobre","treasure":0,"useful_items":0,"mount_vigour":0},{"name":"Frugal","treasure":0,"useful_items":1,"mount_vigour":0},{"name":"Comum","treasure":30,"useful_items":2,"mount_vigour":1},{"name":"Próspero","treasure":90,"useful_items":3,"mount_vigour":2},{"name":"Rico","treasure":180,"useful_items":4,"mount_vigour":3},{"name":"Muito rico","treasure":301,"useful_items":4,"mount_vigour":3}],"weapons":[{"id":"dagger","name":"Adaga","proficiency":"briga","damage":2,"wound":14,"load":0,"hands":1},{"id":"club","name":"Cassetete","proficiency":"briga","damage":3,"wound":12,"load":0,"hands":1},{"id":"cudgel","name":"Tacape","proficiency":"briga","damage":4,"wound":14,"load":1,"hands":1},{"id":"short_sword","name":"Espada Curta","proficiency":"espadas","damage":3,"wound":16,"load":1,"hands":1},{"id":"sword","name":"Espada","proficiency":"espadas","damage":4,"wound":16,"load":2,"hands":1},{"id":"long_sword","name":"Espada Longa","proficiency":"espadas","damage":5,"wound":16,"wound_two_hands":18,"load":3,"hands":0},{"id":"short_spear","name":"Lança Curta","proficiency":"lancas","damage":3,"wound":14,"load":2,"hands":1},{"id":"spear","name":"Lança","proficiency":"lancas","damage":4,"wound":14,"wound_two_hands":16,"load":3,"hands":0},{"id":"long_spear","name":"Lança Longa","proficiency":"lancas","damage":5,"wound":16,"load":4,"hands":2},{"id":"axe","name":"Machado","proficiency":"machados","damage":5,"wound":18,"load":2,"hands":1},{"id":"long_hafted_axe","name":"Machado de Haste Longa","proficiency":"machados","damage":6,"wound":18,"wound_two_hands":20,"load":3,"hands":0},{"id":"great_axe","name":"Machado Grande","proficiency":"machados","damage":7,"wound":20,"load":4,"hands":2},{"id":"mattock","name":"Picareta","proficiency":"machados","damage":7,"wound":18,"load":3,"hands":2},{"id":"bow","name":"Arco","proficiency":"arcos","damage":3,"wound":14,"load":2,"hands":2},{"id":"great_bow","name":"Arco Grande","proficiency":"arcos","damage":4,"wound":16,"load":4,"hands":2}],"armor":[{"id":"none","name":"Sem armadura","protection":0,"load":0,"minimum_living":"Pobre"},{"id":"leather_shirt","name":"Camisa de Couro","protection":1,"load":3,"minimum_living":"Pobre"},{"id":"leather_corselet","name":"Colete de Couro","protection":2,"load":6,"minimum_living":"Pobre"},{"id":"mail_shirt","name":"Camisa de Malha","protection":3,"load":9,"minimum_living":"Comum"},{"id":"coat_mail","name":"Cota de Malha","protection":4,"load":12,"minimum_living":"Próspero"}],"helmet":{"id":"helmet","name":"Elmo","protection":1,"load":4},"shields":[{"id":"none","name":"Sem escudo","parry":0,"load":0,"minimum_living":"Pobre"},{"id":"buckler","name":"Broquel","parry":1,"load":2,"minimum_living":"Pobre"},{"id":"shield","name":"Escudo","parry":2,"load":4,"minimum_living":"Comum"},{"id":"great_shield","name":"Escudo Grande","parry":3,"load":6,"minimum_living":"Próspero"}],"virtues":[{"id":"aptitude","name":"Dom","effect":"attribute_tn","amount":-1,"page":80},{"id":"confidence","name":"Confiança","effect":"hope","amount":2,"page":80},{"id":"dexterity","name":"Destreza","effect":"parry","amount":1,"page":80},{"id":"mastery","name":"Maestria","effect":"favoured","amount":2,"page":80},{"id":"powerful_hands","name":"Mãos Inclementes","effect":"special_damage","amount":1,"page":80},{"id":"resilience","name":"Resiliência","effect":"endurance","amount":2,"page":80}],"rewards":[{"id":"keen","name":"Afiada","targets":["weapon"],"effect":"piercing_on","amount":9,"page":79},{"id":"well_fitted","name":"Ajustado","targets":["armor","helmet"],"effect":"protection_bonus","amount":2,"page":79},{"id":"cunning_make","name":"Fabricação Habilidosa","targets":["armor","helmet","shield"],"effect":"load","amount":-2,"page":79},{"id":"grievous","name":"Cruel","targets":["weapon"],"effect":"wound","amount":2,"page":79},{"id":"fell","name":"Atroz","targets":["weapon"],"effect":"damage","amount":1,"page":79},{"id":"reinforced","name":"Reforçado","targets":["shield"],"effect":"parry","amount":1,"page":79}],"patrons":[{"id":"none","name":"Sem patrono","bonus":0},{"id":"balin","name":"Balin, filho de Fundin","bonus":1},{"id":"bilbo","name":"Bilbo Bolseiro","bonus":2},{"id":"cirdan","name":"Círdan, o Marinheiro","bonus":1},{"id":"gandalf","name":"Gandalf, o Cinzento","bonus":2},{"id":"gilraen","name":"Gilraen, filha de Dírhael","bonus":0},{"id":"tom_bombadil","name":"Tom Bombadil e Senhora Fruta D'Ouro","bonus":2}]}$json$::jsonb $catalog$;
revoke all on function private.one_ring_catalog() from public;

-- One Ring 2e creation is checked in the database for API and sync writes.
create or replace function private.one_ring_v3(p_schema jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(p_schema->>'system_key'='one-ring' and p_schema->'rules_profile_version'='3'::jsonb and p_schema->'version'='3'::jsonb,false)
$$;
revoke all on function private.one_ring_v3(jsonb) from public;
grant execute on function private.one_ring_v3(jsonb) to authenticated;

create or replace function private.one_ring_pick(p_rows jsonb,p_key text,p_value text,p_field text)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare result jsonb;
begin
 select x into result from jsonb_array_elements(p_rows) x where x->>p_key=p_value;
 if result is null then raise exception 'invalid One Ring choice: %',p_field using errcode='23514'; end if;
 return result;
end $$;

create or replace function private.one_ring_list(p_values jsonb,p_field text,p_count integer default null,p_max integer default 200)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare result jsonb:=coalesce(p_values->p_field,'[]'::jsonb);
begin
 if jsonb_typeof(result)<>'array' then raise exception 'invalid One Ring list: %',p_field using errcode='23514'; end if;
 if jsonb_array_length(result)>p_max or (p_count is not null and jsonb_array_length(result)<>p_count)
 or exists(select 1 from jsonb_array_elements(result) x where jsonb_typeof(x)<>'string')
 or (select count(*)<>count(distinct x) from jsonb_array_elements(result) x)
 then raise exception 'invalid One Ring list: %',p_field using errcode='23514'; end if;
 return result;
end $$;

create or replace function private.one_ring_creation(p_values jsonb,p_name text)
returns jsonb language plpgsql immutable set search_path=pg_catalog,private as $$
declare
 c jsonb:=private.one_ring_catalog(); culture jsonb; calling jsonb; virtue jsonb; reward jsonb; living jsonb;
 v jsonb:=p_values; own jsonb:='{}'; numbers jsonb:='{}'; inventory jsonb:='[]'; equipment jsonb:='[]';
 attrs jsonb; armour jsonb; shield jsonb; target jsonb; item jsonb; selected jsonb; favored jsonb; mastery jsonb;
 key text; val jsonb; skill text; primary_skill text; secondary_skill text; kind text; applied text; descr text;
 base integer; rank integer; lvl integer; spent integer:=0; living_rank integer; minimum_rank integer;
 item_load integer; total_load integer:=0; protection_bonus integer:=0; divisor integer; idx integer; attr_value integer;
 seen text[]:=array[]::text[];
begin
 if jsonb_typeof(p_values) is distinct from 'object' or nullif(btrim(p_name),'') is null then raise exception 'invalid One Ring sheet' using errcode='23514'; end if;
 v:=v||jsonb_build_object('nome',btrim(p_name));
 culture:=private.one_ring_pick(c->'cultures','name',v->>'linhagem','linhagem');
 calling:=private.one_ring_pick(c->'callings','name',v->>'vocacao','vocacao');
 if coalesce(v->>'anel_atributos','') !~ '^[1-6]$' then raise exception 'invalid One Ring attribute preset' using errcode='23514'; end if;
 attrs:=culture->'attributes'->((v->>'anel_atributos')::integer-1);
 if culture ? 'attribute_bonus' and not (c->'attributes' @> jsonb_build_array(v->>'anel_bonus_atributo')) then raise exception 'invalid ranger attribute bonus' using errcode='23514'; end if;
 idx:=0;
 for key in select jsonb_array_elements_text(c->'attributes') loop
  attr_value:=(attrs->>idx)::integer+case when culture ? 'attribute_bonus' and v->>'anel_bonus_atributo'=key then (culture->>'attribute_bonus')::integer else 0 end;
  own:=own||jsonb_build_object(key,attr_value); idx:=idx+1;
 end loop;
 own:=own||jsonb_build_object('base_vigor',culture->'bases'->0,'base_esperanca',culture->'bases'->1,'base_aparar',culture->'bases'->2,
   'padrao_vida',culture->'living','idiomas',culture->'languages','bencao_cultural',culture->'blessing');
 living:=private.one_ring_pick(c->'living','name',culture->>'living','padrao_vida');
 own:=own||jsonb_build_object('tesouro',living->'treasure');
 if not (culture->'favoured' @> jsonb_build_array(v->>'anel_favorecida_cultura')) then raise exception 'invalid cultural favoured skill' using errcode='23514'; end if;
 selected:=private.one_ring_list(v,'anel_favorecidas_chamado',2);
 if not (calling->'favoured' @> selected) then raise exception 'invalid calling favoured skills' using errcode='23514'; end if;
 select jsonb_agg(x order by ord) into favored from (select x,min(ord) ord from jsonb_array_elements(jsonb_build_array(v->>'anel_favorecida_cultura')||selected) with ordinality t(x,ord) group by x) u;
 selected:=private.one_ring_list(v,'tracos_distintivos',2);
 if not (culture->'traits' @> selected) then raise exception 'invalid culture traits' using errcode='23514'; end if;
 primary_skill:=v->>'anel_combate_principal'; secondary_skill:=v->>'anel_combate_secundario';
 if not (culture->'combat' @> jsonb_build_array(primary_skill)) or primary_skill=secondary_skill then raise exception 'invalid initial combat proficiencies' using errcode='23514'; end if;
 perform private.one_ring_pick(c->'proficiencies','id',secondary_skill,'anel_combate_secundario');
 for item in select x from jsonb_array_elements(c->'skills') x loop
  key:=item->>'id'; base:=coalesce((culture->'skills'->>key)::integer,0); val:=coalesce(v->key,to_jsonb(base));
  if jsonb_typeof(val)<>'number' or val::text !~ '^[0-9]+$' or (val::text)::numeric not between base and 4 then raise exception 'invalid One Ring skill: %',key using errcode='23514'; end if;
  rank:=(val::text)::integer; v:=v||jsonb_build_object(key,rank);
  for lvl in base+1..rank loop spent:=spent+(c->'skill_costs'->>lvl)::integer; end loop;
 end loop;
 for item in select x from jsonb_array_elements(c->'proficiencies') x loop
  key:=item->>'id'; base:=case key when primary_skill then 2 when secondary_skill then 1 else 0 end; val:=coalesce(v->key,to_jsonb(base));
  if jsonb_typeof(val)<>'number' or val::text !~ '^[0-9]+$' or (val::text)::numeric not between base and 3 then raise exception 'invalid One Ring combat skill: %',key using errcode='23514'; end if;
  rank:=(val::text)::integer; v:=v||jsonb_build_object(key,rank);
  for lvl in base+1..rank loop spent:=spent+(c->'combat_costs'->>lvl)::integer; end loop;
 end loop;
 if spent>(c->>'previous_experience')::integer then raise exception 'One Ring shared experience budget exceeded' using errcode='23514'; end if;
 virtue:=private.one_ring_pick(c->'virtues','id',v->>'anel_virtude','anel_virtude');
 if virtue->>'id'='mastery' then
  mastery:=private.one_ring_list(v,'anel_maestria',2);
  for key in select jsonb_array_elements_text(mastery) loop
   perform private.one_ring_pick(c->'skills','id',key,'anel_maestria');
   if favored @> jsonb_build_array(key) then raise exception 'mastery skill already favoured' using errcode='23514'; end if;
  end loop;
  favored:=favored||mastery;
 end if;
 if virtue->>'id'='aptitude' and not (c->'attributes' @> jsonb_build_array(v->>'anel_dom_atributo')) then raise exception 'invalid aptitude attribute' using errcode='23514'; end if;
 select jsonb_agg(s->'legacy_label' order by ord) into selected from jsonb_array_elements_text(favored) with ordinality f(id,ord)
  join lateral (select x s from jsonb_array_elements(c->'skills') x where x->>'id'=f.id) ss on true;
 own:=own||jsonb_build_object('pericias_favorecidas',selected,'caminho_sombra',calling->'shadow','traco_chamado',calling->'trait');
 if calling ? 'enemy_choice' then
  if not (c->'enemies' @> jsonb_build_array(v->>'anel_inimigo')) then raise exception 'invalid champion enemy' using errcode='23514'; end if;
  own:=own||jsonb_build_object('traco_chamado',(calling->>'trait')||': '||(v->>'anel_inimigo'));
 end if;
 selected:=private.one_ring_list(v,'anel_armas',null,5);
 for key in select jsonb_array_elements_text(selected) loop
  item:=private.one_ring_pick(c->'weapons','id',key,'anel_armas'); skill:=item->>'proficiency';
  if skill=any(seen) or (skill<>'briga' and coalesce((v->>skill)::integer,0)<1)
   or coalesce(culture->'forbidden_equipment','[]'::jsonb) @> jsonb_build_array(key)
   or (culture ? 'allowed_weapons' and not (culture->'allowed_weapons' @> jsonb_build_array(key)))
  then raise exception 'invalid initial weapon' using errcode='23514'; end if;
  seen:=array_append(seen,skill); equipment:=equipment||jsonb_build_array(item||'{"type":"weapon"}'::jsonb);
 end loop;
 armour:=private.one_ring_pick(c->'armor','id',v->>'anel_armadura','anel_armadura');
 shield:=private.one_ring_pick(c->'shields','id',v->>'anel_escudo','anel_escudo');
 select ord::integer into living_rank from jsonb_array_elements(c->'living') with ordinality t(x,ord) where x->>'name'=living->>'name';
 for item in select x from jsonb_array_elements(jsonb_build_array(armour||'{"type":"armor"}'::jsonb,shield||'{"type":"shield"}'::jsonb)) x loop
  select ord::integer into minimum_rank from jsonb_array_elements(c->'living') with ordinality t(x,ord) where x->>'name'=item->>'minimum_living';
  if minimum_rank>living_rank or coalesce(culture->'forbidden_equipment','[]'::jsonb) @> jsonb_build_array(item->>'id') then raise exception 'equipment not available for culture and living standard' using errcode='23514'; end if;
 end loop;
 if jsonb_typeof(v->'anel_elmo') is distinct from 'boolean' then raise exception 'invalid helmet choice' using errcode='23514'; end if;
 if armour->>'id'<>'none' then equipment:=equipment||jsonb_build_array(armour||'{"type":"armor"}'::jsonb); end if;
 if v->'anel_elmo'='true'::jsonb then equipment:=equipment||jsonb_build_array(c->'helmet'||'{"type":"helmet"}'::jsonb); end if;
 if shield->>'id'<>'none' then equipment:=equipment||jsonb_build_array(shield||'{"type":"shield"}'::jsonb); end if;
 reward:=private.one_ring_pick(c->'rewards','id',v->>'anel_recompensa','anel_recompensa');
 target:=private.one_ring_pick(equipment,'id',v->>'anel_recompensa_alvo','anel_recompensa_alvo');
 if not (reward->'targets' @> jsonb_build_array(target->>'type')) then raise exception 'incompatible reward target' using errcode='23514'; end if;
 for item in select x from jsonb_array_elements(equipment) x loop
  kind:=item->>'type'; applied:=case when item->>'id'=target->>'id' then reward->>'id' else '' end;
  item_load:=greatest(0,(item->>'load')::integer-case when applied='cunning_make' then 2 else 0 end);
  divisor:=case when kind in ('armor','helmet') then coalesce((culture->>'armor_load_divisor')::integer,1) else 1 end;
  item_load:=(item_load+divisor-1)/divisor; total_load:=total_load+item_load;
  if applied='well_fitted' then protection_bonus:=protection_bonus+2; end if;
  inventory:=inventory||jsonb_build_array(jsonb_build_object('name',item->'name','category',case when kind='weapon' then 'weapon' when kind in ('armor','helmet') then 'armor' else 'equipment' end,
   'quantity',1,'acquired',true,'equipped',true,'damage_bonus',coalesce((item->>'damage')::integer,0)+case when applied='fell' then 1 else 0 end,'protection',coalesce((item->>'protection')::integer,0),
   'custom_values',jsonb_build_object('catalog_id',item->>'id','carga',item_load,'ferimento',coalesce((item->>'wound')::integer,0)+case when applied='grievous' then 2 else 0 end,
     'ferimento_duas_maos',coalesce((item->>'wound_two_hands')::integer,(item->>'wound')::integer,0)+case when applied='grievous' then 2 else 0 end,
     'protecao_dados',coalesce((item->>'protection')::integer,0),'bonus_bloqueio',coalesce((item->>'parry')::integer,0)+case when applied='reinforced' then 1 else 0 end,
     'recompensa',applied,'proficiencia',coalesce(item->>'proficiency',''))));
 end loop;
 selected:=private.one_ring_list(v,'anel_itens_uteis',null,(living->>'useful_items')::integer);
 for key in select jsonb_array_elements_text(selected) loop
  skill:=split_part(key,':',1); descr:=btrim(substr(key,length(skill)+2));
  perform private.one_ring_pick(c->'skills','id',skill,'anel_itens_uteis');
  if position(':' in key)=0 or descr='' or length(key)>300 then raise exception 'invalid useful item' using errcode='23514'; end if;
  inventory:=inventory||jsonb_build_array(jsonb_build_object('name',descr,'category','equipment','quantity',1,'acquired',true,'equipped',true,'damage_bonus',0,'protection',0,
   'custom_values',jsonb_build_object('catalog_id','useful','carga',0,'proficiencia',skill)));
 end loop;
 own:=own||jsonb_build_object('virtudes',jsonb_build_array(virtue->>'name'),'recompensas',jsonb_build_array(reward->>'name'),'valor',1,'sabedoria',1,
  'bonus_vigor',case when virtue->>'id'='resilience' then 2 else 0 end,'bonus_esperanca',case when virtue->>'id'='confidence' then 2 else 0 end,
  'bonus_aparar',case when virtue->>'id'='dexterity' then 1 else 0 end,'bonus_protecao',protection_bonus,'carga',total_load,
  'bonus_escudo',(shield->>'parry')::integer+case when reward->>'id'='reinforced' and target->>'id'=shield->>'id' then 1 else 0 end,
  'armadura',(armour->>'protection')::integer+case when v->'anel_elmo'='true'::jsonb then (c->'helmet'->>'protection')::integer else 0 end,
  'equipamento',(select coalesce(jsonb_agg(x->'name'),'[]'::jsonb) from jsonb_array_elements(inventory) x));
 for key in select jsonb_array_elements_text(c->'attributes') loop
  own:=own||jsonb_build_object('desconto_tn_'||key,case when virtue->>'id'='aptitude' and v->>'anel_dom_atributo'=key then 1 else 0 end);
  numbers:=numbers||jsonb_build_object('tn_'||key,20-(own->>key)::integer-(own->>('desconto_tn_'||key))::integer);
 end loop;
 numbers:=numbers||jsonb_build_object('vigor_max',(own->>'corpo')::integer+(own->>'base_vigor')::integer+(own->>'bonus_vigor')::integer,
  'esperanca_max',(own->>'coracao')::integer+(own->>'base_esperanca')::integer+(own->>'bonus_esperanca')::integer,
  'aparar',(own->>'astucia')::integer+(own->>'base_aparar')::integer+(own->>'bonus_escudo')::integer+(own->>'bonus_aparar')::integer,'carga_total',total_load,'sombra_total',0);
 own:=own||jsonb_build_object('vigor_marcha',numbers->'vigor_max','esperanca',numbers->'esperanca_max','sombra',0,'cicatrizes',0,'cansaco',0,'ferimento_dias',0,'pontos_aventura',0,'pontos_habilidade',0,'experiencia',0,'ferido',false);
 for key,val in select * from jsonb_each(own) loop
  if p_values ? key and p_values->key is distinct from val then raise exception 'tampered One Ring derived field: %',key using errcode='23514'; end if;
 end loop;
 for key,val in select * from jsonb_each(numbers) loop
  if p_values ? key and p_values->key<>'null'::jsonb and p_values->key is distinct from val then raise exception 'tampered One Ring formula: %',key using errcode='23514'; end if;
 end loop;
 if jsonb_typeof(v->'idade') is distinct from 'number' or coalesce(v->>'idade','') !~ '^[0-9]+$' or (v->>'idade')::numeric not between 1 and 10000 then raise exception 'invalid hero age' using errcode='23514'; end if;
 v:=(v||own)-array(select jsonb_object_keys(numbers));
 return jsonb_build_object('values',v,'derived',numbers,'inventory',inventory,'spent',spent,'remaining',(c->>'previous_experience')::integer-spent);
end $$;
revoke all on function private.one_ring_pick(jsonb,text,text,text),private.one_ring_list(jsonb,text,integer,integer),private.one_ring_creation(jsonb,text) from public;

create or replace function private.one_ring_creation_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare template_schema jsonb; prepared jsonb;
begin
 select schema into template_schema from public.system_templates where id=new.template_id and campaign_id=new.campaign_id and status='approved';
 if private.one_ring_v3(template_schema) then
  if tg_op='UPDATE' then
   if new.template_id is distinct from old.template_id then raise exception 'create a new One Ring v3 sheet instead of switching templates' using errcode='23514'; end if;
   return new;
  end if;
  prepared:=private.one_ring_creation(new.values,new.name);
  new.name:=btrim(new.name); new.values:=prepared->'values';
 end if;
 return new;
end $$;
revoke all on function private.one_ring_creation_guard() from public;
create trigger a_one_ring_creation before insert or update of template_id on public.character_sheets
 for each row execute function private.one_ring_creation_guard();

-- Retain the generic XP/pool policy; only catalog-validated initial v3 resources are exempt.
create or replace function private.guard_managed_sheet_resources()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare template_schema jsonb; guarded text[]; field_id text; previous numeric;
begin
 if current_setting('rpg.atomic_adjustment',true)='on' or private.can_manage_campaign(new.campaign_id) then return new; end if;
 if tg_op='UPDATE' and new.template_id is distinct from old.template_id then raise exception 'only the campaign master can change a sheet template' using errcode='42501'; end if;
 select schema into template_schema from public.system_templates where id=new.template_id;
 if tg_op='INSERT' and private.one_ring_v3(template_schema) then
  perform private.one_ring_creation(new.values,new.name);
  return new;
 end if;
 guarded:=array(select currency->>'field' from jsonb_array_elements(coalesce(template_schema->'meta_currencies','[]'::jsonb)) currency where currency->>'mode'='pool');
 if template_schema->>'experience_field' is not null then guarded:=array_append(guarded,template_schema->>'experience_field'); end if;
 foreach field_id in array guarded loop
  previous:=0;
  if tg_op='UPDATE' and jsonb_typeof(old.values->field_id)='number' then previous:=(old.values->>field_id)::numeric; end if;
  if jsonb_typeof(new.values->field_id)='number' and (new.values->>field_id)::numeric>previous then raise exception 'only the campaign master can raise %',field_id using errcode='42501'; end if;
 end loop;
 return new;
end $$;
revoke all on function private.guard_managed_sheet_resources() from public;

-- The flag is computed from the approved template, never trusted from clients.
alter table public.character_inventory add column one_ring_loadout boolean not null default false;
do $$ declare constraint_name text;
begin
 for constraint_name in select conname from pg_constraint where conrelid='public.character_inventory'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%equipped%' loop
  execute format('alter table public.character_inventory drop constraint %I',constraint_name);
 end loop;
end $$;
alter table public.character_inventory add constraint character_inventory_equipped_valid
 check(not equipped or (acquired and (one_ring_loadout or category in ('weapon','armor'))));
drop index public.character_inventory_one_equipment_idx;
create unique index character_inventory_one_equipment_idx on public.character_inventory(sheet_id,category)
 where equipped and category in ('weapon','armor') and not one_ring_loadout;
create or replace function private.one_ring_inventory_flag()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 select private.one_ring_v3(t.schema) into new.one_ring_loadout from public.character_sheets s
  join public.system_templates t on t.id=s.template_id and t.campaign_id=s.campaign_id where s.id=new.sheet_id and s.campaign_id=new.campaign_id and t.status='approved';
 new.one_ring_loadout:=coalesce(new.one_ring_loadout,false);
 return new;
end $$;
revoke all on function private.one_ring_inventory_flag() from public;
create trigger a_one_ring_inventory_flag before insert or update on public.character_inventory for each row execute function private.one_ring_inventory_flag();

create or replace function private.one_ring_create_inventory()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare template_schema jsonb; prepared jsonb; item jsonb; ordinal integer:=0;
begin
 select schema into template_schema from public.system_templates where id=new.template_id and campaign_id=new.campaign_id and status='approved';
 if not private.one_ring_v3(template_schema) then return new; end if;
 prepared:=private.one_ring_creation(new.values,new.name);
 for item in select x from jsonb_array_elements(prepared->'inventory') x loop
  insert into public.character_inventory(sheet_id,campaign_id,name,category,quantity,acquired,equipped,damage_bonus,protection,custom_values,sort_order)
   values(new.id,new.campaign_id,item->>'name',item->>'category',1,true,true,(item->>'damage_bonus')::integer,(item->>'protection')::integer,item->'custom_values',ordinal);
  ordinal:=ordinal+1;
 end loop;
 return new;
end $$;
revoke all on function private.one_ring_create_inventory() from public;
create trigger a_one_ring_create_inventory after insert on public.character_sheets for each row execute function private.one_ring_create_inventory();

create or replace function public.create_one_ring_sheet(p_campaign_id uuid,p_template_id uuid,p_name text,p_values jsonb,p_portrait_path text default null)
returns public.character_sheets language plpgsql security invoker set search_path=pg_catalog,public,private,auth as $$
declare result public.character_sheets;
begin
 if auth.uid() is null then raise exception 'session required' using errcode='42501'; end if;
 if not exists(select 1 from public.system_templates where id=p_template_id and campaign_id=p_campaign_id and status='approved' and private.one_ring_v3(schema)) then
  raise exception 'approved One Ring v3 template required' using errcode='23514';
 end if;
 insert into public.character_sheets(campaign_id,template_id,owner_id,name,values,portrait_path)
 values(p_campaign_id,p_template_id,auth.uid(),p_name,p_values,p_portrait_path) returning * into result;
 return result;
end $$;
revoke all on function public.create_one_ring_sheet(uuid,uuid,text,jsonb,text) from public,anon;
grant execute on function public.create_one_ring_sheet(uuid,uuid,text,jsonb,text) to authenticated;

-- Extend the existing sync function at its two profile checks without copying its merge protocol.
do $$ declare definition text;
begin
 definition:=pg_get_functiondef('private.mobile_sync_apply_one(uuid,uuid,jsonb)'::regprocedure);
 if position('coalesce(model_schema->''rules_profile_version'',''null''::jsonb)<>''null''::jsonb then' in definition)=0 then
  raise exception 'mobile sync profile guard changed; review One Ring integration';
 end if;
 definition:=replace(definition,'coalesce(model_schema->''rules_profile_version'',''null''::jsonb)<>''null''::jsonb then',
  'coalesce(model_schema->''rules_profile_version'',''null''::jsonb)<>''null''::jsonb and not private.one_ring_v3(model_schema) then');
 definition:=replace(definition,'perform private.mobile_sync_validate_template_schema(model_schema);',
  'if private.one_ring_v3(model_schema) then
     perform private.mobile_sync_validate_template_schema(jsonb_set(model_schema,''{fields}'',
       (select jsonb_agg(field-array[''min'',''max'',''max_length'',''min_items'',''max_items'',''item_options'',''paired_with'',''private'']) from jsonb_array_elements(model_schema->''fields'') field)));
   else perform private.mobile_sync_validate_template_schema(model_schema); end if;');
 execute definition;
end $$;
