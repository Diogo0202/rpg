"""Authoritative creation rules for The One Ring 2e profile v3.

The mechanics live in ``app/data/one_ring_2e.json``. This module only applies
that data to a submitted sheet and derives server-owned values.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "one_ring_2e.json"
ATTRIBUTES = ("corpo", "coracao", "astucia")
PROFILE_SYSTEM_KEY = "one-ring"
PROFILE_VERSION = 3


@lru_cache(maxsize=1)
def catalog() -> dict[str, Any]:
    with CATALOG_PATH.open("r", encoding="utf-8") as source:
        data = json.load(source)
    if data.get("version") != PROFILE_VERSION:
        raise RuntimeError("catálogo canônico de O Um Anel v3 incompatível")
    return data


def is_one_ring_v3(template: dict[str, Any]) -> bool:
    schema = template.get("schema")
    return (
        isinstance(schema, dict)
        and schema.get("system_key") == PROFILE_SYSTEM_KEY
        and schema.get("rules_profile_version") == PROFILE_VERSION
        and schema.get("version") == PROFILE_VERSION
    )


def is_one_ring_profile(template: dict[str, Any]) -> bool:
    schema = template.get("schema")
    return isinstance(schema, dict) and (
        schema.get("system_key") == PROFILE_SYSTEM_KEY
        or schema.get("rules_profile_version") is not None
    )


def _lookup(items: list[dict[str, Any]], key: str, value: Any, label: str) -> dict[str, Any]:
    match = next((item for item in items if item.get(key) == value), None)
    if match is None:
        raise ValueError(f"{label} inválido")
    return match


def _list(value: Any, field: str, *, count: int | None = None, maximum: int | None = None) -> list[Any]:
    if not isinstance(value, list) or (count is not None and len(value) != count) or (maximum is not None and len(value) > maximum):
        suffix = f"precisa conter {count} itens" if count is not None else f"aceita até {maximum} itens"
        raise ValueError(f"{field} {suffix}")
    try:
        unique = len(value) == len(set(value))
    except TypeError:
        unique = False
    if not unique:
        raise ValueError(f"{field} não pode repetir itens")
    return value


def _integer(value: Any, field: str, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{field} precisa ser um inteiro entre {low} e {high}")
    return value


def _cost(start: int, end: int, costs: list[int]) -> int:
    if end < start or end > len(costs) - 1:
        return 10**9
    return sum(costs[start + 1 : end + 1])


def _set_derived(values: dict[str, Any], field: str, value: Any, derived: dict[str, Any]) -> None:
    if field in values and values[field] != value:
        raise ValueError(f"valor derivado adulterado: {field}")
    values[field] = value
    derived[field] = value


def prepare_creation(
    values: dict[str, Any], name: str, template_fields: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    """Validate v3 choices, derive initial values, and return persisted inputs."""
    if not isinstance(values, dict):
        raise ValueError("valores da ficha precisam ser um objeto")
    if not isinstance(name,str) or not name.strip() or len(name.strip()) > 120:
        raise ValueError("nome da ficha não pode ficar vazio")
    data = catalog()
    result = dict(values)
    result["nome"] = name.strip()
    derived: dict[str, Any] = {}

    culture = _lookup(data["cultures"], "name", result.get("linhagem"), "cultura")
    calling = _lookup(data["callings"], "name", result.get("vocacao"), "vocação")

    # The chosen row selects one of the six culture attribute arrays.
    attribute_choice = result.get("anel_atributos")
    if not isinstance(attribute_choice, str) or not attribute_choice.isdigit() or not 1 <= int(attribute_choice) <= len(culture["attributes"]):
        raise ValueError("distribuição cultural de atributos inválida")
    attribute_values = culture["attributes"][int(attribute_choice) - 1]
    attribute_values = dict(zip(ATTRIBUTES, attribute_values))

    # A culture attribute bonus exists only for the Northern Rangers.
    bonus_attr = result.get("anel_bonus_atributo")
    if culture.get("attribute_bonus"):
        if bonus_attr not in ATTRIBUTES:
            raise ValueError("escolha o atributo cultural favorecido")
        bonus = {attribute: int(attribute == bonus_attr) for attribute in ATTRIBUTES}
        for attribute in ATTRIBUTES:
            attribute_values[attribute] += bonus[attribute]
    for attribute, value in attribute_values.items():
        _set_derived(result, attribute, value, derived)

    # Culture and calling skill baselines are server-owned.
    base_skills = {skill["id"]: int(culture["skills"].get(skill["id"], 0)) for skill in data["skills"]}
    for skill_id, base in base_skills.items():
        final = _integer(result.get(skill_id, base), skill_id, base, 4)
        result[skill_id] = final

    favoured_culture = result.get("anel_favorecida_cultura")
    if favoured_culture not in culture["favoured"]:
        raise ValueError("perícia cultural favorecida inválida")
    favoured_calling = _list(result.get("anel_favorecidas_chamado"), "perícias favorecidas da vocação", count=2)
    if any(skill not in calling["favoured"] for skill in favoured_calling):
        raise ValueError("perícia favorecida da vocação inválida")
    if result.get("anel_virtude") == "mastery":
        masteries = _list(result.get("anel_maestria"), "maestrias", count=2)
    else:
        masteries = []
    known_skills = set(base_skills)
    if any(skill not in known_skills for skill in masteries):
        raise ValueError("maestria inválida")
    label_by_id = {skill["id"]: skill["legacy_label"] for skill in data["skills"]}
    favoured_ids = list(dict.fromkeys([favoured_culture, *favoured_calling]))
    if masteries and any(skill in favoured_ids for skill in masteries):
        raise ValueError("Maestria precisa escolher perícias ainda não favorecidas")
    favoured_ids.extend(masteries)
    favoured_labels = list(dict.fromkeys(label_by_id[item] for item in favoured_ids))
    _set_derived(result, "pericias_favorecidas", favoured_labels, derived)

    # Spend up to ten points on skill increases above the culture baseline.
    costs = data["skill_costs"]
    skill_spent = sum(_cost(base_skills[skill_id], result[skill_id], costs) for skill_id in base_skills)
    if skill_spent > 10:
        raise ValueError("as melhorias de perícia excedem 10 pontos")

    proficiencies = {item["id"] for item in data["proficiencies"]}
    primary = result.get("anel_combate_principal")
    if primary not in culture["combat"]:
        raise ValueError("proficiência principal não permitida para esta cultura")
    secondary = result.get("anel_combate_secundario")
    if secondary not in proficiencies or secondary == primary:
        raise ValueError("proficiência secundária precisa ser diferente da principal")
    for proficiency in proficiencies:
        expected = 2 if proficiency == primary else 1 if proficiency == secondary else 0
        final = _integer(result.get(proficiency, expected), proficiency, expected, 3)
        result[proficiency] = final
    combat_spent = sum(_cost((2 if item == primary else 1 if item == secondary else 0), result[item], data["combat_costs"])
                       for item in proficiencies)
    if skill_spent + combat_spent > data["previous_experience"]:
        raise ValueError("as melhorias de perícia e combate excedem 10 pontos compartilhados")

    virtues = {item["id"] for item in data["virtues"]}
    virtue = result.get("anel_virtude")
    if virtue not in virtues:
        raise ValueError("virtude inválida")
    if virtue == "aptitude":
        attribute = result.get("anel_dom_atributo")
        if attribute not in ATTRIBUTES:
            raise ValueError("escolha o atributo do Dom")

    reward = result.get("anel_recompensa")
    reward_row = _lookup(data["rewards"], "id", reward, "recompensa")
    target = result.get("anel_recompensa_alvo")
    if not isinstance(target, str):
        raise ValueError("alvo da recompensa inválido")
    weapons = {item["id"]: item for item in data["weapons"]}
    chosen_weapons = _list(result.get("anel_armas"), "armas", maximum=len(proficiencies) + 1)
    weapon_rows: list[dict[str, Any]] = []
    chosen_proficiencies: set[str] = set()
    forbidden = set(culture.get("forbidden_equipment", []))
    for weapon_id in chosen_weapons:
        weapon = weapons.get(weapon_id)
        if weapon is None:
            raise ValueError("arma inválida")
        if weapon_id in forbidden or (culture.get("allowed_weapons") and weapon_id not in culture["allowed_weapons"]):
            raise ValueError("arma não permitida para esta cultura")
        if weapon["proficiency"] != "briga" and (weapon["proficiency"] not in proficiencies or result[weapon["proficiency"]] < 1):
            raise ValueError("arma requer proficiência treinada")
        if weapon["proficiency"] in chosen_proficiencies:
            raise ValueError("escolha no máximo uma arma por proficiência")
        chosen_proficiencies.add(weapon["proficiency"])
        weapon_rows.append(weapon)

    armor = _lookup(data["armor"], "id", result.get("anel_armadura"), "armadura")
    shield = _lookup(data["shields"], "id", result.get("anel_escudo"), "escudo")
    helmet = result.get("anel_elmo")
    if type(helmet) is not bool:
        raise ValueError("elmo precisa ser verdadeiro ou falso")

    living = next((item for item in data["living"] if item["name"] == culture["living"]), None)
    if living is None:
        raise ValueError("padrão de vida cultural ausente no catálogo")
    _set_derived(result, "padrao_vida", culture["living"], derived)
    _set_derived(result, "tesouro", living["treasure"], derived)
    if data["living"].index(next(item for item in data["living"] if item["name"] == armor["minimum_living"])) > data["living"].index(living):
        raise ValueError("padrão de vida não permite esta armadura")
    if data["living"].index(next(item for item in data["living"] if item["name"] == shield["minimum_living"])) > data["living"].index(living):
        raise ValueError("padrão de vida não permite este escudo")
    if shield["id"] in culture.get("forbidden_equipment", []):
        raise ValueError("escudo não permitido para esta cultura")
    forbidden = set(culture.get("forbidden_equipment", []))
    if forbidden.intersection(chosen_weapons):
        raise ValueError("arma não permitida para esta cultura")

    age = result.get("idade")
    if type(age) is not int or age < 1 or age > 10_000:
        raise ValueError("idade precisa ser um inteiro positivo")
    traits = _list(result.get("tracos_distintivos"), "traços distintivos", count=2)
    if any(trait not in culture["traits"] for trait in traits):
        raise ValueError("traço distintivo não pertence à cultura")

    if calling.get("enemy_choice"):
        enemy = result.get("anel_inimigo")
        if enemy not in data["enemies"]:
            raise ValueError("inimigo inválido")
        calling_trait = enemy
    else:
        calling_trait = None
    called_trait = f"{calling['trait']}: {calling_trait}" if calling.get("enemy_choice") else calling["trait"]
    _set_derived(result, "traco_chamado", called_trait, derived)
    _set_derived(result, "caminho_sombra", calling["shadow"], derived)

    useful = _list(result.get("anel_itens_uteis"), "itens úteis", maximum=living["useful_items"])
    skill_ids = known_skills
    for item in useful:
        if not isinstance(item, str) or ":" not in item or item.split(":", 1)[0] not in skill_ids or not item.split(":", 1)[1].strip() or len(item) > 300:
            raise ValueError("item útil precisa indicar uma perícia e uma descrição")
    blessing_skill = culture.get("blessing")

    equipped_items: dict[str, tuple[dict[str, Any], str]] = {
        item["id"]: (item, "weapon") for item in weapon_rows
    }
    if armor["id"] != "none":
        equipped_items[armor["id"]] = (armor, "armor")
    if helmet:
        equipped_items[data["helmet"]["id"]] = (data["helmet"], "helmet")
    if shield["id"] != "none":
        equipped_items[shield["id"]] = (shield, "shield")
    if target not in equipped_items:
        raise ValueError("alvo da recompensa precisa ser escolhido")
    reward_target, reward_target_type = equipped_items[target]
    if reward_target_type not in reward_row["targets"]:
        raise ValueError("alvo da recompensa incompatível")

    # Initial resources and culture-derived mechanics are recalculated in full.
    virtue_row = _lookup(data["virtues"], "id", virtue, "virtude")
    bonus_vigor = virtue_row["amount"] if virtue_row["effect"] == "endurance" else 0
    bonus_esperanca = virtue_row["amount"] if virtue_row["effect"] == "hope" else 0
    bonus_aparar = virtue_row["amount"] if virtue_row["effect"] == "parry" else 0
    for field, value in {
        "base_vigor": culture["bases"][0], "base_esperanca": culture["bases"][1], "base_aparar": culture["bases"][2],
        "bonus_escudo": shield["parry"] + int(reward == "reinforced" and target == shield["id"]), "bonus_vigor": bonus_vigor, "bonus_esperanca": bonus_esperanca, "bonus_aparar": bonus_aparar,
        "desconto_tn_corpo": int(virtue == "aptitude" and result.get("anel_dom_atributo") == "corpo"),
        "desconto_tn_coracao": int(virtue == "aptitude" and result.get("anel_dom_atributo") == "coracao"),
        "desconto_tn_astucia": int(virtue == "aptitude" and result.get("anel_dom_atributo") == "astucia"),
        "bonus_protecao": 2 if reward == "well_fitted" and reward_target_type in {"armor", "helmet"} else 0, "experiencia": 0, "sombra": 0, "cansaco": 0,
        "sombra_total": 0, "cicatrizes": 0, "ferido": False, "ferimento_dias": 0,
        "pontos_aventura": 0, "pontos_habilidade": 0,
        "bencao_cultural": blessing_skill, "traco_chamado": called_trait,
        "valor": 1, "sabedoria": 1,
        "idiomas": culture["languages"], "virtudes": [virtue_row["name"]], "recompensas": [reward_row["name"]],
    }.items():
        _set_derived(result, field, value, derived)
    _set_derived(result, "vigor_max", result["corpo"] + result["base_vigor"] + bonus_vigor, derived)
    _set_derived(result, "esperanca_max", result["coracao"] + result["base_esperanca"] + bonus_esperanca, derived)
    _set_derived(result, "vigor_marcha", result["vigor_max"], derived)
    _set_derived(result, "esperanca", result["esperanca_max"], derived)
    if virtue == "aptitude":
        attribute = result["anel_dom_atributo"]
        derived[f"desconto_tn_{attribute}"] = 1
    _set_derived(result, "aparar", result["astucia"] + result["base_aparar"] + result["bonus_escudo"] + bonus_aparar, derived)
    for attribute in ATTRIBUTES:
        _set_derived(result, f"tn_{attribute}", 20 - result[attribute] - result[f"desconto_tn_{attribute}"], derived)
    inventory = initial_inventory(result, culture, weapon_rows, armor, shield, reward_row)
    chosen_load = sum(item["custom_values"]["carga"] for item in inventory)
    _set_derived(result, "equipamento", [item["name"] for item in inventory], derived)
    _set_derived(result, "carga", chosen_load, derived)
    _set_derived(result, "armadura", armor["protection"] + (data["helmet"]["protection"] if helmet else 0), derived)
    _set_derived(result, "recompensas", [reward_row["name"]], derived)

    # Formula fields are computed at display time and never stored.
    schema_fields = {field.get("id"): field for field in (template_fields or [])}
    for field_id, field in schema_fields.items():
        if field.get("kind") in {"formula", "roll"}:
            result.pop(field_id, None)
    return result



def initial_inventory(values, culture=None, weapon_rows=None, armor=None, shield=None, reward=None):
    data = catalog()
    culture = culture or _lookup(data["cultures"], "name", values.get("linhagem"), "cultura")
    weapon_rows = weapon_rows if weapon_rows is not None else [_lookup(data["weapons"], "id", key, "arma") for key in values["anel_armas"]]
    armor = armor or _lookup(data["armor"], "id", values.get("anel_armadura"), "armadura")
    shield = shield or _lookup(data["shields"], "id", values.get("anel_escudo"), "escudo")
    reward = reward or _lookup(data["rewards"], "id", values.get("anel_recompensa"), "recompensa")
    equipment = [(item, "weapon") for item in weapon_rows]
    if armor["id"] != "none": equipment.append((armor, "armor"))
    if values["anel_elmo"]: equipment.append((data["helmet"], "helmet"))
    if shield["id"] != "none": equipment.append((shield, "shield"))
    inventory = []
    for item, kind in equipment:
        applied = reward["id"] if item["id"] == values["anel_recompensa_alvo"] else ""
        load = max(0, item["load"] - (2 if applied == "cunning_make" else 0))
        divisor = culture.get("armor_load_divisor", 1) if kind in {"armor", "helmet"} else 1
        load = (load + divisor - 1) // divisor
        inventory.append({"name": item["name"], "category": "weapon" if kind == "weapon" else "armor" if kind in {"armor", "helmet"} else "equipment",
            "quantity": 1, "acquired": True, "equipped": True, "damage_bonus": item.get("damage", 0) + int(applied == "fell"), "protection": item.get("protection", 0),
            "custom_values": {"catalog_id": item["id"], "carga": load, "ferimento": item.get("wound", 0) + 2 * int(applied == "grievous"),
              "ferimento_duas_maos": item.get("wound_two_hands", item.get("wound", 0)) + 2 * int(applied == "grievous"),
              "protecao_dados": item.get("protection", 0), "bonus_bloqueio": item.get("parry", 0) + int(applied == "reinforced"),
              "recompensa": applied, "proficiencia": item.get("proficiency", "")}})
    for useful in values.get("anel_itens_uteis", []):
        skill, _, description = useful.partition(":")
        inventory.append({"name": description.strip(), "category": "equipment", "quantity": 1, "acquired": True, "equipped": True, "damage_bonus": 0, "protection": 0,
            "custom_values": {"catalog_id": "useful", "carga": 0, "proficiencia": skill}})
    return inventory


def evaluate_creation(values: dict[str, Any], name: str | None = None) -> dict[str, Any]:
    """Return field problems and server-derived values for the creation endpoint."""
    from app.services.one_ring import derived as sheet_derived
    normalized = dict(values)
    errors = []
    mandatory = ["nome", "linhagem", "vocacao", "anel_atributos", "anel_favorecida_cultura", "anel_favorecidas_chamado", "anel_combate_principal", "anel_combate_secundario", "anel_virtude", "anel_recompensa", "anel_recompensa_alvo", "anel_armadura", "anel_escudo", "tracos_distintivos"]
    for field in mandatory:
        if not normalized.get(field) and not (field == "nome" and name):
            errors.append({"field": field, "message": f"preencha {field}"})
    inventory = []
    if not errors:
        try:
            normalized = prepare_creation(normalized, name if name is not None else str(values.get("nome", "")))
            inventory = initial_inventory(normalized)
        except (ValueError, TypeError) as error:
            message = str(error)
            field = next((field for field in normalized if field in message), "creation")
            if field == "creation":
                for fragment, candidate in [("cultural de atributos", "anel_atributos"),("atributo cultural", "anel_bonus_atributo"),("cultural favorecida", "anel_favorecida_cultura"),("favorecida da vocação", "anel_favorecidas_chamado"),("Maestria", "anel_maestria"),("maestria", "anel_maestria"),("10 pontos", "experiencia_anterior"),("principal", "anel_combate_principal"),("secundária", "anel_combate_secundario"),("Dom", "anel_dom_atributo"),("virtude", "anel_virtude"),("alvo", "anel_recompensa_alvo"),("recompensa", "anel_recompensa"),("armadura", "anel_armadura"),("escudo", "anel_escudo"),("arma", "anel_armas"),("elmo", "anel_elmo"),("idade", "idade"),("traço", "tracos_distintivos"),("traços", "tracos_distintivos"),("inimigo", "anel_inimigo"),("item útil", "anel_itens_uteis"),("itens úteis", "anel_itens_uteis"),("cultura", "linhagem"),("vocação", "vocacao")]:
                    if fragment in message: field=candidate; break
            errors.append({"field": field, "message": message})
    data = catalog()
    culture = next((x for x in data["cultures"] if x["name"] == normalized.get("linhagem")), None)
    spent = 0
    if culture:
        for item in data["skills"] + data["proficiencies"]:
            field = item["id"]
            combat = item in data["proficiencies"]
            base = (2 if field == normalized.get("anel_combate_principal") else 1 if field == normalized.get("anel_combate_secundario") else 0) if combat else culture["skills"].get(field, 0)
            rank = normalized.get(field, base)
            if type(rank) is int:
                spent += _cost(base, rank, data["combat_costs"] if combat else data["skill_costs"])
    numbers = sheet_derived(normalized)
    return {"values": normalized, "derived": numbers, "errors": errors, "inventory": inventory, "spent": spent, "remaining": data["previous_experience"] - spent}
