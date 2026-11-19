"""Diagnóstico da crônica e cadastro das anotações estruturadas que ele usa."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import UUID

from app.application.chronicle.analysis import AnalysisSettings, CampaignChronicle, Row, build_analysis_request
from app.application.chronicle.ports import ChronicleRecord, ChronicleStore
from app.application.identity import CurrentUser
from app.domain.errors import Forbidden, InvalidInput, LimitExceeded, NotFound
from app.services.chronicle_gaps import analyze_chronicle_gaps

MAX_CHARACTERS = 20
MAX_ACTIVITY_RECORDS = 500
MAX_PROFILE_ENTRIES = 50
MAX_TEMPLATES = 1000
MAX_SHEETS = 1000
MAX_PROFILE_ROWS = MAX_CHARACTERS * MAX_PROFILE_ENTRIES

PROFILE_OVERFLOW = {
    ChronicleRecord.GOAL: "Limite de metas estruturadas excedido.",
    ChronicleRecord.SUPPORTER: "Limite de apoiadores estruturados excedido.",
    ChronicleRecord.DEFECT: "Limite de complicações estruturadas excedido.",
}
PROFILE_LIMIT = {
    ChronicleRecord.GOAL: f"limite de {MAX_PROFILE_ENTRIES} metas por ficha alcançado",
    ChronicleRecord.SUPPORTER: f"limite de {MAX_PROFILE_ENTRIES} apoiadores por ficha alcançado",
    ChronicleRecord.DEFECT: f"limite de {MAX_PROFILE_ENTRIES} complicações por ficha alcançado",
}
NOT_SAVED = {
    ChronicleRecord.GOAL: "não foi possível salvar a meta estruturada",
    ChronicleRecord.SUPPORTER: "não foi possível salvar o apoiador estruturado",
    ChronicleRecord.DEFECT: "não foi possível salvar a complicação estruturada",
    ChronicleRecord.ACTIVITY: "não foi possível salvar a atividade",
}
NOTE_NO_ACTIVITY = (
    "Nenhuma atividade foi registrada; apoiadores sem histórico recente aparecem como sem ameaça registrada "
    "e atributos ou habilidades ficam sem base suficiente."
)
NOTE_LEGACY_TEXT = (
    "Campos antigos de ambição, desejo, defeitos e apoiadores permanecem texto livre. "
    "Cadastre versões estruturadas para incluí-los no diagnóstico."
)
NOTE_UNCLASSIFIED = "Campos numéricos fora do catálogo conhecido foram listados e não entraram na análise de uso."


@dataclass(frozen=True)
class ActivityEntry:
    occurred_on: date
    character_id: UUID
    used_trait_ids: list[str]
    used_ambition_ids: list[UUID]
    used_desire_ids: list[UUID]
    used_defect_ids: list[UUID]
    threatened_supporter_ids: list[UUID]


def _bounded(rows: list[Row], max_rows: int, overflow: str) -> list[Row]:
    if len(rows) > max_rows:
        raise LimitExceeded(overflow)
    return rows


def _ids(values: list[Any]) -> list[str]:
    return [str(value) for value in values]


class ChronicleService:
    def __init__(self, identity: CurrentUser, store: ChronicleStore, today: Callable[[], date] = date.today) -> None:
        self._identity = identity
        self._store = store
        self._today = today

    async def diagnostic(self, campaign_id: UUID, settings: AnalysisSettings) -> dict[str, Any]:
        user_id = await self._identity.current_user_id()
        chronicle = await self._authorized_chronicle(campaign_id, user_id)
        request, characters = build_analysis_request(chronicle, settings)
        report = analyze_chronicle_gaps(request)
        notes = list(report.notes)
        if not chronicle.activity:
            notes.append(NOTE_NO_ACTIVITY)
        if any(character["legacy_text_fields"] for character in characters):
            notes.append(NOTE_LEGACY_TEXT)
        if any(character["unclassified_numeric_field_ids"] for character in characters):
            notes.append(NOTE_UNCLASSIFIED)
        report_data = report.model_dump(mode="json")
        report_data["notes"] = notes
        names = {str(sheet["id"]): str(sheet.get("name") or "Ficha sem nome") for sheet in chronicle.sheets}
        return {
            "report": report_data,
            "characters": characters,
            "activity_records": [_activity_view(row, names) for row in chronicle.activity],
            "limits": {
                "characters_max": MAX_CHARACTERS,
                "activities_max": MAX_ACTIVITY_RECORDS,
                "character_count": len(chronicle.sheets),
                "activity_count": len(chronicle.activity),
                "truncated": False,
            },
        }

    async def add_goal(
        self, campaign_id: UUID, sheet_id: UUID, goal_type: str, statement: str, target_id: str, target_label: str, polarity: str,
    ) -> Row:
        return await self._add_profile_entry(ChronicleRecord.GOAL, campaign_id, sheet_id, {
            "goal_type": goal_type, "statement": statement.strip(), "target_id": target_id.strip(),
            "target_label": target_label.strip(), "polarity": polarity,
        })

    async def add_supporter(self, campaign_id: UUID, sheet_id: UUID, name: str) -> Row:
        return await self._add_profile_entry(ChronicleRecord.SUPPORTER, campaign_id, sheet_id, {"name": name.strip()})

    async def add_defect(self, campaign_id: UUID, sheet_id: UUID, statement: str) -> Row:
        return await self._add_profile_entry(ChronicleRecord.DEFECT, campaign_id, sheet_id, {"statement": statement.strip()})

    async def add_activity(self, campaign_id: UUID, entry: ActivityEntry) -> Row:
        user_id = await self._identity.current_user_id()
        chronicle = await self._authorized_character(campaign_id, entry.character_id, user_id)
        if len(chronicle.activity) >= MAX_ACTIVITY_RECORDS:
            raise LimitExceeded(f"limite de {MAX_ACTIVITY_RECORDS} atividades alcançado; remova registros antes de gravar")
        today = self._today()
        request, _ = build_analysis_request(chronicle, AnalysisSettings(as_of=today, min_activity_records=1))
        character = next(item for item in request.characters if item.id == str(entry.character_id))
        if entry.occurred_on > today:
            raise InvalidInput("a atividade não pode estar no futuro")
        groups = [entry.used_trait_ids, entry.used_ambition_ids, entry.used_desire_ids, entry.used_defect_ids, entry.threatened_supporter_ids]
        if any(len(group) != len(set(group)) for group in groups):
            raise InvalidInput("cada referência pode aparecer uma vez no registro")
        foreign = (
            set(entry.used_trait_ids) - {item.id for item in character.traits}
            or set(_ids(entry.used_ambition_ids)) - {item.id for item in character.ambitions}
            or set(_ids(entry.used_desire_ids)) - {item.id for item in character.desires}
            or set(_ids(entry.used_defect_ids)) - {item.id for item in character.defects}
            or set(_ids(entry.threatened_supporter_ids)) - {item.id for item in character.supporters}
        )
        if foreign:
            raise InvalidInput("o registro contém uma referência que não pertence à ficha selecionada")
        return await self._insert(ChronicleRecord.ACTIVITY, {
            "campaign_id": str(campaign_id), "sheet_id": str(entry.character_id),
            "occurred_on": entry.occurred_on.isoformat(), "used_trait_ids": entry.used_trait_ids,
            "used_goal_ids": _ids([*entry.used_ambition_ids, *entry.used_desire_ids]),
            "used_defect_ids": _ids(entry.used_defect_ids),
            "threatened_supporter_ids": _ids(entry.threatened_supporter_ids),
            "created_by": user_id,
        })

    # Apoio ------------------------------------------------------------------------------

    async def _add_profile_entry(self, kind: ChronicleRecord, campaign_id: UUID, sheet_id: UUID, fields: Row) -> Row:
        user_id = await self._identity.current_user_id()
        chronicle = await self._authorized_character(campaign_id, sheet_id, user_id)
        existing = {
            ChronicleRecord.GOAL: chronicle.goals,
            ChronicleRecord.SUPPORTER: chronicle.supporters,
            ChronicleRecord.DEFECT: chronicle.defects,
        }[kind]
        if sum(str(row.get("sheet_id")) == str(sheet_id) for row in existing) >= MAX_PROFILE_ENTRIES:
            raise LimitExceeded(PROFILE_LIMIT[kind])
        return await self._insert(kind, {"campaign_id": str(campaign_id), "sheet_id": str(sheet_id), **fields, "created_by": user_id})

    async def _insert(self, kind: ChronicleRecord, row: Row) -> Row:
        saved = await self._store.insert_record(kind, row)
        if not saved:
            raise Forbidden(NOT_SAVED[kind])
        return saved

    async def _require_manager(self, campaign_id: UUID, user_id: str) -> None:
        if await self._store.campaign_owner(campaign_id) == user_id:
            return
        if not await self._store.is_campaign_manager(campaign_id, user_id):
            raise Forbidden("diagnóstico disponível somente para narradores desta campanha")

    async def _authorized_chronicle(self, campaign_id: UUID, user_id: str) -> CampaignChronicle:
        await self._require_manager(campaign_id, user_id)
        return await self._load(campaign_id)

    async def _authorized_character(self, campaign_id: UUID, sheet_id: UUID, user_id: str) -> CampaignChronicle:
        chronicle = await self._authorized_chronicle(campaign_id, user_id)
        if not any(str(sheet["id"]) == str(sheet_id) for sheet in chronicle.sheets):
            raise NotFound("ficha aprovada não encontrada nesta campanha")
        return chronicle

    async def _load(self, campaign_id: UUID) -> CampaignChronicle:
        templates = _bounded(
            await self._store.approved_templates(campaign_id, MAX_TEMPLATES), MAX_TEMPLATES,
            f"Mais de {MAX_TEMPLATES} modelos aprovados nesta campanha.",
        )
        sheet_refs = _bounded(
            await self._store.sheet_refs(campaign_id, MAX_SHEETS), MAX_SHEETS, f"Mais de {MAX_SHEETS} fichas nesta campanha.",
        )
        approved = {str(template["id"]) for template in templates if template.get("status") == "approved"}
        eligible = [str(sheet["id"]) for sheet in sheet_refs if str(sheet.get("template_id")) in approved]
        if len(eligible) > MAX_CHARACTERS:
            raise LimitExceeded(f"diagnóstico limitado a {MAX_CHARACTERS} fichas aprovadas; nenhuma ficha foi omitida")
        sheets = await self._store.sheets(campaign_id, eligible) if eligible else []
        profiles = {
            kind: _bounded(await self._store.records(kind, campaign_id, eligible, MAX_PROFILE_ROWS), MAX_PROFILE_ROWS, overflow)
            for kind, overflow in PROFILE_OVERFLOW.items()
        }
        activity = _bounded(
            await self._store.records(ChronicleRecord.ACTIVITY, campaign_id, eligible, MAX_ACTIVITY_RECORDS),
            MAX_ACTIVITY_RECORDS, f"Diagnóstico limitado a {MAX_ACTIVITY_RECORDS} atividades.",
        )
        sheet_ids = {str(sheet["id"]) for sheet in sheets}
        # Nenhum registro é ignorado em silêncio: anotações de ficha fora do conjunto aprovado são inconsistência.
        if any(str(row.get("sheet_id")) not in sheet_ids for rows in profiles.values() for row in rows):
            raise InvalidInput("há anotações ligadas a ficha fora do conjunto aprovado da campanha")
        if any(str(row.get("sheet_id")) not in sheet_ids for row in activity):
            raise InvalidInput("há atividades ligadas a ficha fora do conjunto aprovado da campanha")
        return CampaignChronicle(
            templates, sheets, profiles[ChronicleRecord.GOAL], profiles[ChronicleRecord.SUPPORTER],
            profiles[ChronicleRecord.DEFECT], activity,
        )


def _activity_view(row: Row, names: dict[str, str]) -> Row:
    return {
        "id": str(row["id"]),
        "occurred_on": str(row["occurred_on"]),
        "character_id": str(row["sheet_id"]),
        "character_name": names[str(row["sheet_id"])],
        "used_trait_ids": list(row.get("used_trait_ids") or []),
        "used_goal_ids": _ids(row.get("used_goal_ids") or []),
        "used_defect_ids": _ids(row.get("used_defect_ids") or []),
        "threatened_supporter_ids": _ids(row.get("threatened_supporter_ids") or []),
    }
