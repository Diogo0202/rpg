from __future__ import annotations

import os
from datetime import date
from typing import Annotated, Any, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictStr, model_validator

from app.services.chronicle_gaps import (
    ActivityRecord,
    ChronicleCharacter,
    ChronicleGapRequest,
    Goal,
    GoalPolarity,
    SheetNote,
    SheetTrait,
    Supporter,
    TraitCategory,
    analyze_chronicle_gaps,
)


router = APIRouter(prefix="/api/v1/campaigns/{campaign_id}/chronicle", tags=["chronicle"])
MAX_CHARACTERS = 20
MAX_ACTIVITY_RECORDS = 500
MAX_PROFILE_ENTRIES = 50
SUPABASE_PAGE_SIZE = 500

# IDs come from the checked-in Nexus starters. Other number fields are not
# treated as attributes or skills unless their schema adds explicit metadata.
ATTRIBUTE_IDS = {
    "forca", "destreza", "vigor", "carisma", "manipulacao", "autocontrole",
    "inteligencia", "raciocinio", "resolucao", "coracao", "espirito", "strength", "heart", "wits",
}
SKILL_IDS = {
    "atletismo", "briga", "conducao", "furtividade", "ladroagem", "oficios",
    "sobrevivencia", "armas_brancas", "armas_de_fogo", "etiqueta", "empatia",
    "intimidacao", "lideranca", "manha", "performance", "persuasao", "subterfugio",
    "trato_com_animais", "academicos", "ciencia", "consciencia", "financas",
    "investigacao", "medicina", "ocultismo", "percepcao", "tecnologia", "awe",
    "athletics", "awareness", "hunting", "song", "travel",
}
LEGACY_TEXT_FIELD_IDS = {"ambicao", "desejo", "defeitos", "apoiadores"}


class GoalCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    goal_type: Literal["ambition", "desire"]
    statement: StrictStr = Field(min_length=1, max_length=500)
    target_id: StrictStr = Field(min_length=1, max_length=80)
    target_label: StrictStr = Field(min_length=1, max_length=120)
    polarity: Literal["pursues", "prevents"]


class SupporterCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: StrictStr = Field(min_length=1, max_length=120)


class DefectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    statement: StrictStr = Field(min_length=1, max_length=500)


class ActivityCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    occurred_on: date
    character_id: UUID
    used_trait_ids: list[StrictStr] = Field(default_factory=list, max_length=50)
    used_ambition_ids: list[UUID] = Field(default_factory=list, max_length=50)
    used_desire_ids: list[UUID] = Field(default_factory=list, max_length=50)
    used_defect_ids: list[UUID] = Field(default_factory=list, max_length=50)
    threatened_supporter_ids: list[UUID] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def unique_bounded_references(self) -> "ActivityCreate":
        groups = (
            self.used_trait_ids,
            [*self.used_ambition_ids, *self.used_desire_ids],
            self.used_defect_ids,
            self.threatened_supporter_ids,
        )
        if any(len(group) != len(set(group)) for group in groups):
            raise ValueError("cada referência pode aparecer uma vez no registro")
        if len(self.used_ambition_ids) + len(self.used_desire_ids) > 50:
            raise ValueError("o registro pode apontar para até 50 metas")
        return self


async def _request_supabase(
    method: str,
    table: str,
    authorization: str,
    *,
    params: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> Any:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=503, detail="Supabase da API não está configurado")
    headers = {
        "apikey": supabase_key,
        "Authorization": authorization,
        "Accept": "application/json",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if method in {"POST", "PATCH", "DELETE"}:
        headers["Prefer"] = "return=representation"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.request(
                method,
                f"{supabase_url.rstrip('/')}/rest/v1/{table}",
                headers=headers,
                params=params,
                json=payload,
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Supabase indisponível") from error
    if response.status_code in (401, 403):
        raise HTTPException(status_code=403, detail="operação não permitida nesta campanha")
    if response.status_code >= 400:
        if response.status_code == 400 and payload is not None:
            raise HTTPException(status_code=422, detail="dados do registro foram rejeitados")
        raise HTTPException(status_code=503, detail="não foi possível consultar os dados da campanha")
    if not response.content:
        return []
    try:
        return response.json()
    except ValueError as error:
        raise HTTPException(status_code=503, detail="resposta inválida do Supabase") from error


async def _request_bounded_rows(
    table: str, authorization: str, params: dict[str, str], *, max_rows: int, overflow_detail: str,
) -> list[dict[str, Any]]:
    """Read a complete bounded result without relying on Supabase's row cap."""
    rows: list[dict[str, Any]] = []
    while len(rows) <= max_rows:
        page_size = min(SUPABASE_PAGE_SIZE, max_rows + 1 - len(rows))
        page = await _request_supabase(
            "GET", table, authorization,
            params={**params, "limit": str(page_size), "offset": str(len(rows))},
        )
        rows.extend(page)
        if len(page) < page_size:
            break
    if len(rows) > max_rows:
        raise HTTPException(status_code=413, detail=overflow_detail)
    return rows


async def _current_user_id(authorization: str | None) -> str:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=503, detail="autenticação da API não está configurada")
    if not authorization or not authorization.startswith("Bearer ") or len(authorization) > 8192:
        raise HTTPException(status_code=401, detail="sessão necessária")
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                f"{supabase_url.rstrip('/')}/auth/v1/user",
                headers={"apikey": supabase_key, "Authorization": authorization},
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="serviço de autenticação indisponível") from error
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="sessão inválida")
    try:
        return str(UUID(response.json()["id"]))
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=401, detail="sessão inválida") from error


async def _require_campaign_manager(campaign_id: UUID, authorization: str, user_id: str) -> None:
    campaigns = await _request_supabase(
        "GET", "campaigns", authorization,
        params={"select": "id,owner_id", "id": f"eq.{campaign_id}", "limit": "1"},
    )
    if campaigns and campaigns[0].get("owner_id") == user_id:
        return
    memberships = await _request_supabase(
        "GET", "campaign_members", authorization,
        params={
            "select": "role", "campaign_id": f"eq.{campaign_id}",
            "user_id": f"eq.{user_id}", "role": "in.(owner,master)", "limit": "1",
        },
    )
    if not memberships:
        raise HTTPException(status_code=403, detail="diagnóstico disponível somente para narradores desta campanha")


async def _load_campaign_data(campaign_id: UUID, authorization: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    campaign_filter = f"eq.{campaign_id}"
    templates = await _request_bounded_rows(
        "system_templates", authorization,
        {"select": "id,campaign_id,name,version,schema,status", "campaign_id": campaign_filter,
         "status": "eq.approved", "order": "name.asc,version.desc"},
        max_rows=1000, overflow_detail="Mais de 1000 modelos aprovados nesta campanha.",
    )
    sheet_refs = await _request_bounded_rows(
        "character_sheets", authorization,
        {"select": "id,template_id", "campaign_id": campaign_filter, "order": "id.asc"},
        max_rows=1000, overflow_detail="Mais de 1000 fichas nesta campanha.",
    )
    approved = {str(template["id"]): template for template in templates if template.get("status") == "approved"}
    eligible_ids = [str(sheet["id"]) for sheet in sheet_refs if str(sheet.get("template_id")) in approved]
    if len(eligible_ids) > MAX_CHARACTERS:
        raise HTTPException(status_code=413, detail=f"diagnóstico limitado a {MAX_CHARACTERS} fichas aprovadas; nenhuma ficha foi omitida")
    sheets = []
    if eligible_ids:
        sheets = await _request_supabase(
            "GET", "character_sheets", authorization,
            params={
                "select": "id,campaign_id,template_id,owner_id,name,values,updated_at",
                "campaign_id": campaign_filter, "id": f"in.({','.join(eligible_ids)})", "order": "id.asc",
                "limit": str(MAX_CHARACTERS),
            },
        )
    scoped = {"campaign_id": campaign_filter}
    if eligible_ids:
        scoped["sheet_id"] = f"in.({','.join(eligible_ids)})"
    goals = await _request_bounded_rows(
        "chronicle_goals", authorization,
        {"select": "id,sheet_id,goal_type,statement,target_id,target_label,polarity", **scoped, "order": "created_at.asc,id.asc"},
        max_rows=MAX_CHARACTERS * MAX_PROFILE_ENTRIES, overflow_detail="Limite de metas estruturadas excedido.",
    )
    supporters = await _request_bounded_rows(
        "chronicle_supporters", authorization,
        {"select": "id,sheet_id,name", **scoped, "order": "created_at.asc,id.asc"},
        max_rows=MAX_CHARACTERS * MAX_PROFILE_ENTRIES, overflow_detail="Limite de apoiadores estruturados excedido.",
    )
    defects = await _request_bounded_rows(
        "chronicle_defects", authorization,
        {"select": "id,sheet_id,statement", **scoped, "order": "created_at.asc,id.asc"},
        max_rows=MAX_CHARACTERS * MAX_PROFILE_ENTRIES, overflow_detail="Limite de complicações estruturadas excedido.",
    )
    activity = await _request_bounded_rows(
        "chronicle_activity", authorization,
        {"select": "id,sheet_id,occurred_on,used_trait_ids,used_goal_ids,used_defect_ids,threatened_supporter_ids",
         **scoped, "order": "occurred_on.asc,id.asc"},
        max_rows=MAX_ACTIVITY_RECORDS, overflow_detail=f"Diagnóstico limitado a {MAX_ACTIVITY_RECORDS} atividades.",
    )
    sheet_ids = {str(sheet["id"]) for sheet in sheets}
    # Ignore no record silently: report configuration that points to a sheet
    # outside the currently approved roster as an explicit inconsistency.
    if any(str(row.get("sheet_id")) not in sheet_ids for rows in (goals, supporters, defects) for row in rows):
        raise HTTPException(status_code=422, detail="há anotações ligadas a ficha fora do conjunto aprovado da campanha")
    if any(str(row.get("sheet_id")) not in sheet_ids for row in activity):
        raise HTTPException(status_code=422, detail="há atividades ligadas a ficha fora do conjunto aprovado da campanha")
    return templates, sheets, goals, supporters, defects, activity


def _make_analysis_request(
    sheets: list[dict[str, Any]], templates: list[dict[str, Any]], goals: list[dict[str, Any]],
    supporters: list[dict[str, Any]], defects: list[dict[str, Any]], activity: list[dict[str, Any]],
    *, as_of: date, supporter_recency_days: int, min_activity_records: int, underused_trait_share: float,
) -> tuple[ChronicleGapRequest, list[dict[str, Any]]]:
    template_by_id = {str(template["id"]): template for template in templates}
    goals_by_sheet: dict[str, list[dict[str, Any]]] = {}
    supporters_by_sheet: dict[str, list[dict[str, Any]]] = {}
    defects_by_sheet: dict[str, list[dict[str, Any]]] = {}
    for row in goals:
        goals_by_sheet.setdefault(str(row["sheet_id"]), []).append(row)
    for row in supporters:
        supporters_by_sheet.setdefault(str(row["sheet_id"]), []).append(row)
    for row in defects:
        defects_by_sheet.setdefault(str(row["sheet_id"]), []).append(row)

    characters: list[ChronicleCharacter] = []
    character_meta: list[dict[str, Any]] = []
    for sheet in sheets:
        sheet_id = str(sheet["id"])
        template = template_by_id.get(str(sheet.get("template_id")), {})
        schema = template.get("schema") if isinstance(template.get("schema"), dict) else {}
        field_rows = schema.get("fields") if isinstance(schema.get("fields"), list) else []
        values = sheet.get("values") if isinstance(sheet.get("values"), dict) else {}
        traits: list[SheetTrait] = []
        legacy: list[dict[str, Any]] = []
        ignored_numeric: list[str] = []
        seen_trait_ids: set[str] = set()
        for field in field_rows:
            if not isinstance(field, dict) or not isinstance(field.get("id"), str):
                continue
            field_id = field["id"]
            if field_id in LEGACY_TEXT_FIELD_IDS:
                legacy.append({"id": field_id, "populated": field_id in values})
            if field.get("kind") != "number":
                continue
            if field_id in seen_trait_ids:
                raise HTTPException(status_code=422, detail=f"template aprovado repete o campo {field_id}")
            seen_trait_ids.add(field_id)
            if field_id in ATTRIBUTE_IDS:
                category = TraitCategory.attribute
            elif field_id in SKILL_IDS:
                category = TraitCategory.skill
            else:
                if field_id in values:
                    ignored_numeric.append(field_id)
                continue
            traits.append(SheetTrait(id=field_id, name=str(field.get("label") or field_id)[:120], category=category))
        ambitions: list[Goal] = []
        desires: list[Goal] = []
        for row in goals_by_sheet.get(sheet_id, []):
            try:
                goal = Goal(
                    id=str(row["id"]), statement=row["statement"], target_id=row["target_id"],
                    target_label=row["target_label"], polarity=GoalPolarity(row["polarity"]),
                )
            except (KeyError, TypeError, ValueError) as error:
                raise HTTPException(status_code=422, detail="uma meta estruturada está inválida") from error
            (ambitions if row["goal_type"] == "ambition" else desires).append(goal)
        supporter_models = [Supporter(id=str(row["id"]), name=row["name"]) for row in supporters_by_sheet.get(sheet_id, [])]
        defect_models = [SheetNote(id=str(row["id"]), text=row["statement"]) for row in defects_by_sheet.get(sheet_id, [])]
        character = ChronicleCharacter(
            id=sheet_id, name=str(sheet.get("name") or "Ficha sem nome"), ambitions=ambitions,
            desires=desires, supporters=supporter_models, defects=defect_models, traits=traits,
        )
        characters.append(character)
        character_meta.append({
            "id": sheet_id,
            "name": character.name,
            "template_id": str(sheet.get("template_id")),
            "template_name": str(template.get("name") or "Modelo aprovado"),
            "traits": [trait.model_dump(mode="json") for trait in traits],
            "ambitions": [goal.model_dump(mode="json") for goal in ambitions],
            "desires": [goal.model_dump(mode="json") for goal in desires],
            "supporters": [supporter.model_dump(mode="json") for supporter in supporter_models],
            "defects": [defect.model_dump(mode="json") for defect in defect_models],
            "legacy_text_fields": legacy,
            "unclassified_numeric_field_ids": ignored_numeric,
        })

    by_character = {character.id: character for character in characters}
    activity_models: list[ActivityRecord] = []
    goal_type_by_id = {goal.id: "ambition" for character in characters for goal in character.ambitions}
    goal_type_by_id.update({goal.id: "desire" for character in characters for goal in character.desires})
    goals_by_id = {goal.id: goal for character in characters for goal in (*character.ambitions, *character.desires)}
    defects_by_id = {item.id: item for character in characters for item in character.defects}
    supporters_by_id = {item.id: item for character in characters for item in character.supporters}
    for row in activity:
        character_id = str(row["sheet_id"])
        char = by_character[character_id]
        goal_ids = [str(value) for value in row.get("used_goal_ids", [])]
        activity_models.append(ActivityRecord(
            id=str(row["id"]), occurred_on=row["occurred_on"], character_id=character_id,
            used_trait_ids=list(row.get("used_trait_ids") or []),
            used_ambition_ids=[value for value in goal_ids if goal_type_by_id.get(value) == "ambition"],
            used_desire_ids=[value for value in goal_ids if goal_type_by_id.get(value) == "desire"],
            used_defect_ids=[str(value) for value in row.get("used_defect_ids", [])],
            threatened_supporter_ids=[str(value) for value in row.get("threatened_supporter_ids", [])],
        ))
        if any(value not in goals_by_id for value in goal_ids):
            raise HTTPException(status_code=422, detail="uma atividade aponta para meta ausente")
        if any(value not in defects_by_id for value in activity_models[-1].used_defect_ids):
            raise HTTPException(status_code=422, detail="uma atividade aponta para complicação ausente")
        if any(value not in supporters_by_id for value in activity_models[-1].threatened_supporter_ids):
            raise HTTPException(status_code=422, detail="uma atividade aponta para apoiador ausente")
        if any(value not in {trait.id for trait in char.traits} for value in activity_models[-1].used_trait_ids):
            raise HTTPException(status_code=422, detail="uma atividade aponta para atributo ou habilidade ausente")

    try:
        request = ChronicleGapRequest(
            characters=characters, activity=activity_models, as_of=as_of,
            supporter_recency_days=supporter_recency_days,
            min_activity_records=min_activity_records,
            underused_trait_share=underused_trait_share,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=f"dados estruturados inconsistentes: {error}") from error
    return request, character_meta


async def _authorized_data(campaign_id: UUID, authorization: str | None, user_id: str):
    if not authorization:
        raise HTTPException(status_code=401, detail="sessão necessária")
    await _require_campaign_manager(campaign_id, authorization, user_id)
    data = await _load_campaign_data(campaign_id, authorization)
    return data


@router.get("")
async def get_chronicle_diagnostic(
    campaign_id: UUID,
    authorization: Annotated[str | None, Header()] = None,
    as_of: date = Query(default_factory=date.today),
    supporter_recency_days: int = Query(default=90, ge=1, le=3650),
    min_activity_records: int = Query(default=5, ge=1, le=MAX_ACTIVITY_RECORDS),
    underused_trait_share: float = Query(default=0.05, gt=0, le=1),
) -> dict[str, Any]:
    user_id = await _current_user_id(authorization)
    data = await _authorized_data(campaign_id, authorization, user_id)
    templates, sheets, goals, supporters, defects, activity = data
    request, characters = _make_analysis_request(
        sheets, templates, goals, supporters, defects, activity,
        as_of=as_of, supporter_recency_days=supporter_recency_days,
        min_activity_records=min_activity_records, underused_trait_share=underused_trait_share,
    )
    report = analyze_chronicle_gaps(request)
    notes = list(report.notes)
    if not activity:
        notes.append("Nenhuma atividade foi registrada; apoiadores sem histórico recente aparecem como sem ameaça registrada e atributos ou habilidades ficam sem base suficiente.")
    if any(character["legacy_text_fields"] for character in characters):
        notes.append("Campos antigos de ambição, desejo, defeitos e apoiadores permanecem texto livre. Cadastre versões estruturadas para incluí-los no diagnóstico.")
    if any(character["unclassified_numeric_field_ids"] for character in characters):
        notes.append("Campos numéricos fora do catálogo conhecido foram listados e não entraram na análise de uso.")
    report_data = report.model_dump(mode="json")
    report_data["notes"] = notes
    character_names = {str(sheet["id"]): str(sheet.get("name") or "Ficha sem nome") for sheet in sheets}
    return {
        "report": report_data,
        "characters": characters,
        "activity_records": [
            {
                "id": str(row["id"]),
                "occurred_on": str(row["occurred_on"]),
                "character_id": str(row["sheet_id"]),
                "character_name": character_names[str(row["sheet_id"])],
                "used_trait_ids": list(row.get("used_trait_ids") or []),
                "used_goal_ids": [str(value) for value in row.get("used_goal_ids") or []],
                "used_defect_ids": [str(value) for value in row.get("used_defect_ids") or []],
                "threatened_supporter_ids": [str(value) for value in row.get("threatened_supporter_ids") or []],
            }
            for row in activity
        ],
        "limits": {
            "characters_max": MAX_CHARACTERS,
            "activities_max": MAX_ACTIVITY_RECORDS,
            "character_count": len(sheets),
            "activity_count": len(activity),
            "truncated": False,
        },
    }


async def _authorize_character(campaign_id: UUID, sheet_id: UUID, authorization: str | None, user_id: str):
    data = await _authorized_data(campaign_id, authorization, user_id)
    _, sheets, _, _, _, _ = data
    if not any(str(sheet["id"]) == str(sheet_id) for sheet in sheets):
        raise HTTPException(status_code=404, detail="ficha aprovada não encontrada nesta campanha")
    return data


@router.post("/characters/{sheet_id}/goals", status_code=201)
async def create_chronicle_goal(
    campaign_id: UUID,
    sheet_id: UUID,
    payload: GoalCreate,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    user_id = await _current_user_id(authorization)
    _, _, goals, _, _, _ = await _authorize_character(campaign_id, sheet_id, authorization, user_id)
    if sum(str(row.get("sheet_id")) == str(sheet_id) for row in goals) >= MAX_PROFILE_ENTRIES:
        raise HTTPException(status_code=413, detail=f"limite de {MAX_PROFILE_ENTRIES} metas por ficha alcançado")
    rows = await _request_supabase(
        "POST", "chronicle_goals", authorization or "",
        payload={
            "campaign_id": str(campaign_id), "sheet_id": str(sheet_id),
            "goal_type": payload.goal_type, "statement": payload.statement.strip(),
            "target_id": payload.target_id.strip(), "target_label": payload.target_label.strip(),
            "polarity": payload.polarity, "created_by": user_id,
        },
    )
    if not rows:
        raise HTTPException(status_code=403, detail="não foi possível salvar a meta estruturada")
    return rows[0]


@router.post("/characters/{sheet_id}/supporters", status_code=201)
async def create_chronicle_supporter(
    campaign_id: UUID,
    sheet_id: UUID,
    payload: SupporterCreate,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    user_id = await _current_user_id(authorization)
    _, _, _, supporters, _, _ = await _authorize_character(campaign_id, sheet_id, authorization, user_id)
    if sum(str(row.get("sheet_id")) == str(sheet_id) for row in supporters) >= MAX_PROFILE_ENTRIES:
        raise HTTPException(status_code=413, detail=f"limite de {MAX_PROFILE_ENTRIES} apoiadores por ficha alcançado")
    rows = await _request_supabase(
        "POST", "chronicle_supporters", authorization or "",
        payload={"campaign_id": str(campaign_id), "sheet_id": str(sheet_id), "name": payload.name.strip(), "created_by": user_id},
    )
    if not rows:
        raise HTTPException(status_code=403, detail="não foi possível salvar o apoiador estruturado")
    return rows[0]


@router.post("/characters/{sheet_id}/defects", status_code=201)
async def create_chronicle_defect(
    campaign_id: UUID,
    sheet_id: UUID,
    payload: DefectCreate,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    user_id = await _current_user_id(authorization)
    _, _, _, _, defects, _ = await _authorize_character(campaign_id, sheet_id, authorization, user_id)
    if sum(str(row.get("sheet_id")) == str(sheet_id) for row in defects) >= MAX_PROFILE_ENTRIES:
        raise HTTPException(status_code=413, detail=f"limite de {MAX_PROFILE_ENTRIES} complicações por ficha alcançado")
    rows = await _request_supabase(
        "POST", "chronicle_defects", authorization or "",
        payload={"campaign_id": str(campaign_id), "sheet_id": str(sheet_id), "statement": payload.statement.strip(), "created_by": user_id},
    )
    if not rows:
        raise HTTPException(status_code=403, detail="não foi possível salvar a complicação estruturada")
    return rows[0]


@router.post("/activity", status_code=201)
async def create_chronicle_activity(
    campaign_id: UUID,
    payload: ActivityCreate,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    user_id = await _current_user_id(authorization)
    data = await _authorize_character(campaign_id, payload.character_id, authorization, user_id)
    templates, sheets, goals, supporters, defects, activity = data
    if len(activity) >= MAX_ACTIVITY_RECORDS:
        raise HTTPException(status_code=413, detail=f"limite de {MAX_ACTIVITY_RECORDS} atividades alcançado; remova registros antes de gravar")
    request, _ = _make_analysis_request(
        sheets, templates, goals, supporters, defects, activity, as_of=date.today(),
        supporter_recency_days=90, min_activity_records=1, underused_trait_share=0.05,
    )
    character = next(item for item in request.characters if item.id == str(payload.character_id))
    if payload.occurred_on > date.today():
        raise HTTPException(status_code=422, detail="a atividade não pode estar no futuro")
    trait_ids = {item.id for item in character.traits}
    ambitions = {item.id for item in character.ambitions}
    desires = {item.id for item in character.desires}
    character_defects = {item.id for item in character.defects}
    character_supporters = {item.id for item in character.supporters}
    groups = [payload.used_trait_ids, payload.used_ambition_ids, payload.used_desire_ids, payload.used_defect_ids, payload.threatened_supporter_ids]
    if any(len(group) != len(set(group)) for group in groups):
        raise HTTPException(status_code=422, detail="cada referência pode aparecer uma vez no registro")
    if (set(payload.used_trait_ids) - trait_ids
        or {str(value) for value in payload.used_ambition_ids} - ambitions
        or {str(value) for value in payload.used_desire_ids} - desires
        or {str(value) for value in payload.used_defect_ids} - character_defects
        or {str(value) for value in payload.threatened_supporter_ids} - character_supporters):
        raise HTTPException(status_code=422, detail="o registro contém uma referência que não pertence à ficha selecionada")
    goal_ids = [str(value) for value in (*payload.used_ambition_ids, *payload.used_desire_ids)]
    rows = await _request_supabase(
        "POST", "chronicle_activity", authorization or "",
        payload={
            "campaign_id": str(campaign_id), "sheet_id": str(payload.character_id),
            "occurred_on": payload.occurred_on.isoformat(), "used_trait_ids": payload.used_trait_ids,
            "used_goal_ids": goal_ids, "used_defect_ids": [str(value) for value in payload.used_defect_ids],
            "threatened_supporter_ids": [str(value) for value in payload.threatened_supporter_ids],
            "created_by": user_id,
        },
    )
    if not rows:
        raise HTTPException(status_code=403, detail="não foi possível salvar a atividade")
    return rows[0]
