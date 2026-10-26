from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.services.combat_blocks import (
    COMBAT_SYSTEMS,
    COMBAT_TIERS,
    CombatBlock,
    build_combat_block,
    second_inquisition_block,
    second_inquisition_tier,
)
from app.services.content_generator import generate_content


@pytest.mark.parametrize("system", COMBAT_SYSTEMS)
def test_blocks_are_deterministic_and_flagged_for_book_check(system: str) -> None:
    for tier in COMBAT_TIERS:
        first = build_combat_block(system, tier, 42)
        assert first == build_combat_block(system, tier, 42)
        assert first.needs_book_check is True
        assert "conferir no livro" in first.review_note
        assert 0 <= first.initiative <= 1000 and 1 <= first.health <= 1000


@pytest.mark.parametrize("system", COMBAT_SYSTEMS)
@pytest.mark.parametrize("seed", [0, 1, 7, 2**63, 2**64 - 1])
def test_harder_tiers_never_weaken_the_block(system: str, seed: int) -> None:
    blocks = [build_combat_block(system, tier, seed) for tier in COMBAT_TIERS]
    for lower, higher in zip(blocks, blocks[1:]):
        assert higher.health >= lower.health
        assert higher.defense >= lower.defense
        assert higher.initiative >= lower.initiative
    assert blocks[-1].health > blocks[0].health


def test_seed_changes_the_block() -> None:
    results = {build_combat_block("v5", "padrao", seed).model_dump_json() for seed in range(20)}
    assert len(results) > 1


@pytest.mark.parametrize("bad", [("v4", "padrao", 1), ("v5", "lendario", 1), ("v5", "padrao", -1), ("v5", "padrao", True)])
def test_invalid_inputs_are_rejected(bad: tuple) -> None:
    with pytest.raises(ValueError):
        build_combat_block(*bad)


def test_block_validation_refuses_removing_book_check_and_out_of_range_values() -> None:
    data = build_combat_block("sotdl", "chefe", 3).model_dump()
    with pytest.raises(ValidationError):
        CombatBlock(**{**data, "needs_book_check": False})
    with pytest.raises(ValidationError):
        CombatBlock(**{**data, "health": 0})
    with pytest.raises(ValidationError):
        CombatBlock(**{**data, "initiative": 1001})
    with pytest.raises(ValidationError):
        CombatBlock(**{**data, "extra": 1})


def test_generator_attaches_block_without_changing_seeded_content() -> None:
    plain = generate_content("enemy", seed=99)
    with_block = generate_content("enemy", seed=99, combat_system="one_ring", difficulty="perigoso")
    assert plain.name == with_block.name
    assert {k: v for k, v in with_block.details.items() if k != "combat_block"} == plain.details
    assert with_block.details["combat_block"]["tier"] == "perigoso"
    assert with_block.details["combat_block"]["system"] == "one_ring"
    with pytest.raises(ValueError):
        generate_content("item", seed=1, combat_system="v5")


def test_second_inquisition_block_uses_panel_stats() -> None:
    assert [second_inquisition_tier(level) for level in range(0, 6)] == ["fraco", "fraco", "padrao", "perigoso", "chefe", "chefe"]
    block = second_inquisition_block({"team_size": 5, "combat_pool": 8, "health": 7, "armor": 3, "coordination": 3}, 3, 11)
    assert block.health == 7 and block.defense == 3 and block.tier == "perigoso"
    assert block.stats["agentes"] == 5 and "Parada 8" in block.attack
    with pytest.raises(ValueError):
        second_inquisition_block({"combat_pool": "x"}, 2, 1)
