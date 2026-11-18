"""Casos de uso de fichas: regras de criação, edição e recursos, sem HTTP nem banco."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.application.sheets.ports import CurrentUser, EvocationRegistration, NewSheet, Row, SheetRepository
from app.domain.errors import Conflict, Forbidden, InvalidInput, NotFound
from app.models import TemplateDraft
from app.services.hunter_traits import template_creation_problems
from app.services.one_ring_creation import evaluate_creation as evaluate_one_ring_creation
from app.services.one_ring_creation import is_one_ring_v3
from app.services.sheet_calculations import calculate_sheet
from app.services.sheet_creation import approved_template_draft, creation_report, prepare_sheet_creation
from app.services.sheet_values import validate_sheet_values
from app.services.sotdl_progression import validate_sotdl_advance

SHADOW_OF_THE_DEMON_LORD = "shadow-demon-lord"
NOT_ALLOWED = "operação não permitida nesta campanha"


def template_draft(template: Row) -> TemplateDraft:
    try:
        return approved_template_draft(template)
    except ValueError as error:
        raise InvalidInput(str(error)) from error


def template_fields(template: Row) -> dict[str, dict[str, Any]]:
    return {field.id: field.model_dump(mode="json") for field in template_draft(template).fields}


def validate_values(values: dict[str, Any], fields: dict[str, dict[str, Any]]) -> None:
    try:
        validate_sheet_values(values, fields)
    except ValueError as error:
        raise InvalidInput(str(error)) from error


def check_portrait_owner(portrait_path: str | None, campaign_id: UUID, user_id: str) -> None:
    """A foto precisa estar na pasta desta campanha e pertencer a quem a enviou."""
    if portrait_path is None:
        return
    campaign_folder, uploader_folder, _ = portrait_path.split("/", 2)
    if campaign_folder != str(campaign_id) or uploader_folder != user_id:
        raise InvalidInput("o retrato precisa ser enviado por você nesta campanha")


class SheetService:
    def __init__(self, identity: CurrentUser, sheets: SheetRepository) -> None:
        self._identity = identity
        self._sheets = sheets

    # Modelos e consulta ----------------------------------------------------------------

    async def list_templates(self, campaign_id: UUID) -> list[Row]:
        await self._identity.current_user_id()
        return await self._sheets.approved_templates(campaign_id)

    async def list_sheets(self, campaign_id: UUID, owner_id: UUID | None) -> list[Row]:
        await self._identity.current_user_id()
        return await self._sheets.sheets_of_campaign(campaign_id, owner_id)

    async def get_sheet(self, sheet_id: UUID) -> Row:
        await self._identity.current_user_id()
        sheet = await self._sheets.sheet(sheet_id)
        if sheet is None:
            raise NotFound("ficha não encontrada")
        return sheet

    async def list_events(self, sheet_id: UUID, limit: int) -> list[Row]:
        await self._identity.current_user_id()
        return await self._sheets.events(sheet_id, limit)

    async def list_versions(self, sheet_id: UUID, limit: int) -> list[Row]:
        await self._identity.current_user_id()
        return await self._sheets.versions(sheet_id, limit)

    # Criação ----------------------------------------------------------------------------

    async def validate_creation(self, campaign_id: UUID, template_id: UUID, values: dict[str, Any]) -> dict[str, Any]:
        """Confere um rascunho do assistente contra os limites e regras do modelo aprovado."""
        await self._identity.current_user_id()
        template = await self._approved_template(campaign_id, template_id)
        if is_one_ring_v3(template):
            return _one_ring_creation_report(template, values)
        try:
            errors, violations = creation_report(template, values)
        except ValueError as error:
            raise InvalidInput(str(error)) from error
        errors.extend(_hunter_problems(template_draft(template), values))
        return {
            "valid": not errors and not violations,
            "field_errors": errors,
            "violations": [violation.model_dump() for violation in violations],
        }

    async def create_sheet(
        self,
        campaign_id: UUID,
        template_id: UUID,
        name: str,
        values: dict[str, Any],
        portrait_path: str | None,
    ) -> Row:
        user_id = await self._identity.current_user_id()
        check_portrait_owner(portrait_path, campaign_id, user_id)
        template = await self._approved_template(campaign_id, template_id)
        one_ring = is_one_ring_v3(template)
        if portrait_path is None and not one_ring:
            raise InvalidInput("envie o retrato do personagem antes de criar a ficha")
        try:
            draft, sheet_name, sheet_values = prepare_sheet_creation(template, name, values)
        except ValueError as error:
            raise InvalidInput(str(error)) from error
        hunter_problems = _hunter_problems(draft, sheet_values)
        if hunter_problems:
            raise InvalidInput("; ".join(hunter_problems))
        new_sheet = NewSheet(campaign_id, template_id, user_id, sheet_name, sheet_values, portrait_path)
        insert = self._sheets.insert_one_ring_sheet if one_ring else self._sheets.insert_sheet
        created = await insert(new_sheet)
        if not created:
            raise Forbidden(NOT_ALLOWED)
        return created

    # Edição -----------------------------------------------------------------------------

    async def update_sheet(self, sheet_id: UUID, expected_version: int, changes: dict[str, Any]) -> Row:
        await self._identity.current_user_id()
        if not changes:
            raise InvalidInput("informe nome ou valores para salvar")
        new_values = changes.get("values")
        if new_values is not None:
            await self._check_new_values(sheet_id, new_values)
        updated = await self._sheets.update_sheet(sheet_id, expected_version, changes)
        if not updated:
            raise Conflict("ficha alterada ou inacessível; recarregue antes de salvar")
        return updated

    async def delete_sheet(self, sheet_id: UUID, expected_version: int) -> None:
        await self._identity.current_user_id()
        if not await self._sheets.delete_sheet(sheet_id, expected_version):
            raise Conflict("ficha alterada ou inacessível; recarregue antes de excluir")

    async def restore_version(self, sheet_id: UUID, version: int, expected_version: int) -> Row:
        """Grava uma versão antiga como nova; versão esperada desatualizada gera conflito."""
        if version < 1:
            raise InvalidInput("versão inválida")
        await self._identity.current_user_id()
        return await self._sheets.restore_version(sheet_id, version, expected_version)

    # Recursos da ficha ------------------------------------------------------------------

    async def adjust_number(
        self, sheet_id: UUID, operation_id: UUID, field_id: str, delta: int, reason: str | None,
    ) -> Row:
        """Soma um delta de forma atômica; edições concorrentes nunca geram conflito."""
        await self._identity.current_user_id()
        return await self._sheets.adjust_number(sheet_id, operation_id, field_id, delta, reason)

    async def add_experience(self, sheet_id: UUID, amount: int, reason: str | None) -> Row:
        """Valores positivos são concessões do narrador; o dono gasta com valores negativos."""
        await self._identity.current_user_id()
        return await self._sheets.add_experience(sheet_id, amount, reason)

    async def spend_meta_currency(self, sheet_id: UUID, currency_id: str, amount: int, reason: str | None) -> Row:
        """Valores positivos gastam o recurso; negativos o recuperam."""
        await self._identity.current_user_id()
        sheet = await self.get_sheet(sheet_id)
        template = await self._approved_template(UUID(sheet["campaign_id"]), UUID(sheet["template_id"]))
        draft = template_draft(template)
        currency = next((item for item in draft.meta_currencies if item.id == currency_id), None)
        if currency is None:
            raise NotFound("recurso não existe neste modelo")
        if currency.max_field is not None:
            _check_currency_maximum(draft, sheet["values"], currency, amount)
        return await self._sheets.spend_meta_currency(sheet_id, currency_id, amount, reason)

    # Evocações de Demônio ---------------------------------------------------------------

    async def list_demon_evocations(self, campaign_id: UUID) -> list[Row]:
        await self._identity.current_user_id()
        return await self._sheets.demon_evocations(campaign_id)

    async def register_demon_evocation(self, campaign_id: UUID, registration: EvocationRegistration) -> Row:
        await self._identity.current_user_id()
        return await self._sheets.register_demon_evocation(campaign_id, registration)

    async def activate_demon_evocation(
        self, sheet_id: UUID, evocation_id: UUID, operation_id: UUID, expected_version: int,
    ) -> Row:
        await self._identity.current_user_id()
        return await self._sheets.activate_demon_evocation(sheet_id, evocation_id, operation_id, expected_version)

    # Apoio ------------------------------------------------------------------------------

    async def _approved_template(self, campaign_id: UUID, template_id: UUID) -> Row:
        template = await self._sheets.approved_template(campaign_id, template_id)
        if template is None:
            raise NotFound("template aprovado não encontrado nesta campanha")
        return template

    async def _check_new_values(self, sheet_id: UUID, new_values: dict[str, Any]) -> None:
        current = await self.get_sheet(sheet_id)
        template = await self._approved_template(UUID(current["campaign_id"]), UUID(current["template_id"]))
        validate_values(new_values, template_fields(template))
        if template.get("schema", {}).get("system_key") == SHADOW_OF_THE_DEMON_LORD:
            try:
                validate_sotdl_advance(current["values"], new_values)
            except ValueError as error:
                raise InvalidInput(str(error)) from error


def _hunter_problems(draft: TemplateDraft, values: dict[str, Any]) -> list[str]:
    """Traços, Triunfos e Distinções do Caçador são conferidos na criação."""
    return template_creation_problems(draft.system_key, draft.version, {field.id for field in draft.fields}, values)


def _one_ring_creation_report(template: Row, values: dict[str, Any]) -> dict[str, Any]:
    report = evaluate_one_ring_creation(values)
    fields = template_fields(template)
    for field_id, value in values.items():
        if field_id not in fields:
            report["errors"].append({"field": field_id, "message": f"campo desconhecido: {field_id}"})
            continue
        try:
            validate_sheet_values({field_id: value}, {field_id: fields[field_id]})
        except ValueError as error:
            report["errors"].append({"field": field_id, "message": str(error)})
    return {
        "valid": not report["errors"],
        "field_errors": [problem["message"] for problem in report["errors"]],
        "field_problems": report["errors"],
        "violations": [],
        "derived": report["derived"],
        "spent": report["spent"],
        "remaining": report["remaining"],
    }


def _check_currency_maximum(draft: TemplateDraft, values: dict[str, Any], currency: Any, amount: int) -> None:
    """Máximos por fórmula (como Vontade = Autocontrole + Determinação) só são calculáveis aqui.

    A função do banco garante o piso zero e os máximos fixos.
    """
    delta = amount if currency.mode == "track" else -amount
    current = values.get(currency.field, 0)
    inputs = {key: value for key, value in values.items() if value is not None}
    try:
        maximum = calculate_sheet(draft, inputs).get(currency.max_field)
    except (ValueError, KeyError, ArithmeticError) as error:
        raise InvalidInput("não foi possível calcular o máximo do recurso") from error
    numbers = (int, float)
    if isinstance(current, numbers) and isinstance(maximum, numbers) and current + delta > maximum:
        raise InvalidInput(f"{currency.label} não pode passar de {maximum}")
