"""Geradores procedurais: mapa tático, NPC, inimigo e item, e aplicação do resultado na campanha."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.application.generated_content import ContentApplication, ContentApplications, apply_content
from app.domain.errors import InvalidInput
from app.services.content_generator import generate_content
from app.services.tactical_maps import generate_tactical_map

Row = dict[str, Any]
# world_entities é lido por todos os membros: estes detalhes ficam só com o narrador.
NARRATOR_ONLY_DETAILS = frozenset({"secret", "story_hook", "weakness", "encounter_hook", "combat_block"})
GENERATOR_SOURCE = "Gerador original RPG-Atlas"


def generated_entity_body(content: Row) -> Row:
    details = {key: value for key, value in content["details"].items() if key not in NARRATOR_ONLY_DETAILS}
    return {
        "description": content["summary"],
        "generated": {"kind": content["kind"], "name": content["name"], "summary": content["summary"], "details": details, "seed": content["seed"]},
        "role": "antagonist" if content["kind"] == "enemy" else "neutral",
        "source": GENERATOR_SOURCE,
    }


def tactical_map(width: int, height: int, room_count: int, seed: int | str) -> Row:
    try:
        return generate_tactical_map(width=width, height=height, room_count=room_count, seed=seed)
    except ValueError as error:
        raise InvalidInput(str(error)) from error


def campaign_content(kind: str, **options: Any) -> Row:
    try:
        return generate_content(kind, **options).model_dump(mode="json")
    except ValueError as error:
        raise InvalidInput(str(error)) from error


@dataclass(frozen=True)
class ContentApplyOrder:
    """GER-06: o servidor regenera o conteúdo pela seed; o cliente não envia estatísticas."""

    kind: str
    seed: int
    combat_system: str | None
    difficulty: str
    save_entity: bool
    combat_id: UUID | None
    idempotency_key: UUID


class GeneratorService:
    def __init__(self, applications: ContentApplications) -> None:
        self._applications = applications

    async def apply(self, campaign_id: UUID, order: ContentApplyOrder) -> Row:
        content = campaign_content(order.kind, seed=order.seed, combat_system=order.combat_system, difficulty=order.difficulty)
        block = content["details"].get("combat_block")
        result = await apply_content(self._applications, ContentApplication(
            campaign_id=campaign_id,
            idempotency_key=order.idempotency_key,
            source_kind="generator",
            source_ref={
                "kind": order.kind, "seed": order.seed, "combat_system": order.combat_system,
                "difficulty": order.difficulty if block else None, "generator": "content_generator",
            },
            name=content["name"],
            entity_kind="npc",
            entity_body=generated_entity_body(content),
            save_entity=order.save_entity,
            combat_id=order.combat_id,
            combat_block=block,
        ))
        return {"application": result, "content": content}
