from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.routes.generators import require_signed_in_user
from app.routes.system_rolls import router
from app.services import system_rolls
from app.services.system_rolls import (
    HunterRollRequest,
    OneRingRollRequest,
    SotdlRollRequest,
    roll_hunter,
    roll_one_ring,
    roll_sotdl,
    roll_sotdl_fate,
)


@pytest.fixture
def client():
    test_app = FastAPI()
    test_app.include_router(router)
    test_app.dependency_overrides[require_signed_in_user] = lambda: None
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.pop(require_signed_in_user, None)


def force_rolls(monkeypatch: pytest.MonkeyPatch, values: list[int]) -> None:
    rolls = iter(values)
    monkeypatch.setattr(system_rolls.secrets, "randbelow", lambda bound: next(rolls))


def test_hunter_uses_optional_additional_desperation_dice(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [9, 9, 0, 5, 9, 9])
    result = roll_hunter(HunterRollRequest(base_pool=4, difficulty=5, desperation=2, use_desperation=True))
    assert result.normal_dice == [10, 10, 1, 6]
    assert result.desperation_dice == [10, 10]
    assert result.total_pool == 6
    assert result.desperation_ones == 0
    assert result.critical_pairs == 2
    assert result.successes == 9
    assert result.success is True
    assert result.verdict == "Crítico"


def test_hunter_reports_desperation_one_for_table_adjudication(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [5, 5, 0])
    result = roll_hunter(HunterRollRequest(base_pool=2, difficulty=2, desperation=1, use_desperation=True))
    assert result.desperation_ones == 1
    assert result.success is True
    assert result.desperation_consequence == "table_choice"


def test_hunter_desperation_is_off_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [5, 5])
    result = roll_hunter(HunterRollRequest(base_pool=2, difficulty=1, desperation=5))
    assert result.normal_dice == [6, 6]
    assert result.desperation_dice == []
    assert result.total_pool == 2


def test_hunter_validation_is_strict_and_bounded() -> None:
    with pytest.raises(ValidationError):
        HunterRollRequest(base_pool=True, difficulty=1)
    with pytest.raises(ValidationError):
        HunterRollRequest(base_pool=31, difficulty=1)
    with pytest.raises(ValidationError):
        HunterRollRequest(base_pool=4, difficulty=1, desperation=-1)
    with pytest.raises(ValidationError):
        HunterRollRequest(base_pool=4, difficulty=1, desperation=1, extra_field=1)
    with pytest.raises(ValidationError):
        HunterRollRequest(base_pool=30, difficulty=70)


def test_one_ring_eye_is_zero_and_weary_zeros_low_success_dice(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [10, 0, 2, 5])
    result = roll_one_ring(OneRingRollRequest(target=7, skill_dice=3, endurance=10, load=10))
    assert result.feat_die == 11
    assert result.eye_of_sauron is True
    assert result.success is False
    assert result.weary is True
    assert result.success_dice == [1, 3, 6]
    assert result.counted_success_dice == [0, 0, 6]
    assert result.success is False


def test_one_ring_eye_can_succeed_from_success_dice_total(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [10, 5, 5, 5, 5, 5, 5])
    result = roll_one_ring(OneRingRollRequest(target=36, skill_dice=6, endurance=20, load=0))
    assert result.eye_of_sauron is True
    assert result.total == 36
    assert result.success is True


def test_one_ring_gandalf_rune_is_automatic_success(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [11, 0])
    result = roll_one_ring(OneRingRollRequest(target=99, skill_dice=1, endurance=11, load=10))
    assert result.feat_die == 12
    assert result.automatic_success is True
    assert result.success is True
    assert result.weary is False


@pytest.mark.parametrize(
    ("favored", "ill_favored", "rolls", "picked"),
    [(True, False, [10, 11], 12), (False, True, [1, 10], 11)],
)
def test_one_ring_favor_selects_best_or_worst_feat_die(
    monkeypatch: pytest.MonkeyPatch, favored: bool, ill_favored: bool, rolls: list[int], picked: int
) -> None:
    force_rolls(monkeypatch, rolls)
    result = roll_one_ring(OneRingRollRequest(
        target=1, skill_dice=0, endurance=1, load=0, favored=favored, ill_favored=ill_favored,
    ))
    assert result.feat_dice == [roll + 1 for roll in rolls]
    assert result.feat_die == picked


def test_one_ring_rejects_conflicting_favor_and_invalid_bounds() -> None:
    with pytest.raises(ValidationError):
        OneRingRollRequest(target=1, skill_dice=1, endurance=1, load=0, favored=True, ill_favored=True)
    with pytest.raises(ValidationError):
        OneRingRollRequest(target=1, skill_dice=True, endurance=1, load=0)
    with pytest.raises(ValidationError):
        OneRingRollRequest(target=1, skill_dice=7, endurance=1, load=0)


def test_sotdl_boons_and_banes_cancel_and_the_highest_d6_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    # d20 = 8; 3 boons - 1 bane leave 2 boon dice, 2 and 5.
    force_rolls(monkeypatch, [7, 1, 4])
    result = roll_sotdl(SotdlRollRequest(attribute=12, boons=3, banes=1))
    assert (result.d20, result.modifier, result.net_boons) == (8, 2, 2)
    assert result.boon_dice == [2, 5]
    assert result.boon_value == 5
    assert result.total == 15
    assert result.success is True
    assert result.critical is False


def test_sotdl_banes_subtract_and_can_fail(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [9, 3, 0])
    result = roll_sotdl(SotdlRollRequest(attribute=10, banes=2, target=10))
    assert result.boon_dice == [4, 1]
    assert result.boon_value == -4
    assert result.total == 6
    assert result.verdict == "Falha"


def test_sotdl_equal_boons_and_banes_roll_no_d6(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [9])
    result = roll_sotdl(SotdlRollRequest(attribute=10, boons=2, banes=2, target=10))
    assert result.boon_dice == []
    assert result.total == 10
    assert result.success is True


def test_sotdl_critical_needs_twenty_and_five_over_target(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [17])
    assert roll_sotdl(SotdlRollRequest(attribute=12, target=15)).critical is True
    force_rolls(monkeypatch, [17])
    assert roll_sotdl(SotdlRollRequest(attribute=12, target=16)).critical is False


@pytest.mark.parametrize(("roll", "outcome"), [(0, "dying"), (1, "stable"), (4, "stable"), (5, "recovers")])
def test_sotdl_fate_roll(monkeypatch: pytest.MonkeyPatch, roll: int, outcome: str) -> None:
    force_rolls(monkeypatch, [roll])
    result = roll_sotdl_fate()
    assert (result.die, result.outcome) == (roll + 1, outcome)


def test_sotdl_validation_is_strict_and_bounded() -> None:
    for payload in ({"attribute": 0}, {"attribute": 21}, {"attribute": True}, {"attribute": 10, "boons": 11},
                    {"attribute": 10, "target": 0}, {"attribute": 10, "extra": 1}):
        with pytest.raises(ValidationError):
            SotdlRollRequest(**payload)


def test_sotdl_routes_return_rolls(client, monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [19, 2, 0])
    response = client.post("/api/v1/system-rolls/shadow-demon-lord", json={"attribute": 9, "boons": 1, "target": 12})
    assert response.status_code == 200
    assert response.json()["total"] == 22
    assert response.json()["critical"] is True
    fate = client.post("/api/v1/system-rolls/shadow-demon-lord/fate")
    assert fate.status_code == 200
    assert fate.json()["outcome"] == "dying"


def test_roll_routes_require_signed_in_user() -> None:
    test_app = FastAPI()
    test_app.include_router(router)
    with TestClient(test_app) as client:
        response = client.post("/api/v1/system-rolls/hunter", json={"base_pool": 2, "difficulty": 1})
    assert response.status_code in (401, 503)


def test_hunter_route_returns_separate_additional_dice(client, monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [5, 0, 9])
    response = client.post("/api/v1/system-rolls/hunter", json={
        "base_pool": 2, "difficulty": 2, "desperation": 1, "use_desperation": True,
    })
    assert response.status_code == 200
    assert response.json()["normal_dice"] == [6, 1]
    assert response.json()["desperation_dice"] == [10]
    assert response.json()["total_pool"] == 3
    assert response.json()["success"] is True


# --- Frente J: O Um Anel (Miserável, Ferido, Sombra, jornada, ficha) e Caçador (traços) ---

from app.routes import system_rolls as system_rolls_routes
from app.services.session_roll_activity import RollActivityResult
from app.services.system_rolls import (
    JourneyEventRequest,
    OneRingShadowTestRequest,
    SheetValuesRequest,
    hunter_traits,
    one_ring_sheet,
    roll_journey_event,
    roll_one_ring_shadow_test,
)


def test_one_ring_miserable_turns_the_eye_into_automatic_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    # Eye of Sauron with a total that would otherwise reach the target.
    force_rolls(monkeypatch, [10, 5, 5, 5])
    result = roll_one_ring(OneRingRollRequest(target=12, skill_dice=3, endurance=20, load=0, miserable=True))
    assert result.total == 18
    assert result.automatic_failure is True
    assert result.success is False
    assert result.success_icons == 0
    assert "Miserável: o Olho de Sauron é falha automática" in result.notes


def test_one_ring_miserable_is_derived_from_shadow_and_hope(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [10, 5])
    result = roll_one_ring(OneRingRollRequest(target=1, skill_dice=1, endurance=20, load=0, hope=4, shadow=4))
    assert (result.miserable, result.automatic_failure, result.success) == (True, True, False)
    force_rolls(monkeypatch, [10, 5])
    result = roll_one_ring(OneRingRollRequest(target=1, skill_dice=1, endurance=20, load=0, hope=5, shadow=4))
    assert (result.miserable, result.success) == (False, True)


def test_one_ring_miserable_without_eye_and_gandalf_still_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [11])
    result = roll_one_ring(OneRingRollRequest(target=99, skill_dice=0, endurance=20, load=0, miserable=True, wounded=True))
    assert result.automatic_success is True and result.success is True
    assert result.wounded is True
    assert any(note.startswith("Ferido") for note in result.notes)


def test_one_ring_shadow_test_gains_points_only_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [1, 0])  # feat 2, one success die 1
    failed = roll_one_ring_shadow_test(OneRingShadowTestRequest(
        source="pavor", points=2, target=14, rating=1, endurance=20, load=0, hope=3, shadow=1))
    assert failed.trait == "valor"
    assert (failed.shadow_gained, failed.shadow_after, failed.miserable_after) == (2, 3, True)
    force_rolls(monkeypatch, [9, 5, 5])
    passed = roll_one_ring_shadow_test(OneRingShadowTestRequest(
        source="ganancia", points=3, target=14, rating=2, endurance=20, load=0, hope=8, shadow=0))
    assert passed.trait == "sabedoria"
    assert (passed.roll.success, passed.shadow_gained) == (True, 0)


@pytest.mark.parametrize(("region", "rolls", "event", "fatigue"), [
    ("selvagem", [10, 0], "infortunio_terrivel", 3),
    ("selvagem", [0, 2], "desespero", 2),
    ("selvagem", [2, 3], "mas_escolhas", 2),
    ("selvagem", [5, 4], "contratempo", 2),
    ("selvagem", [8, 5], "atalho", 1),
    ("selvagem", [9, 0], "encontro_casual", 1),
    ("selvagem", [11, 0], "visao_alegre", 0),
    ("fronteira", [10, 11, 0], "visao_alegre", 0),
    ("sombria", [11, 10, 0], "infortunio_terrivel", 3),
])
def test_journey_event_table(monkeypatch: pytest.MonkeyPatch, region: str, rolls: list[int], event: str, fatigue: int) -> None:
    force_rolls(monkeypatch, rolls)
    result = roll_journey_event(JourneyEventRequest(region=region))
    assert (result.event, result.fatigue) == (event, fatigue)
    assert len(result.feat_dice) == (1 if region == "selvagem" else 2)
    assert result.role_die == rolls[-1] + 1
    assert result.skill in {"travel", "explore", "hunting", "awareness"}


def test_journey_event_rejects_unknown_region() -> None:
    with pytest.raises(ValidationError):
        JourneyEventRequest(region="mordor")


def one_ring_values() -> dict:
    return {"linhagem": "Hobbits do Condado", "corpo": 3, "coracao": 6, "astucia": 5,
            "base_vigor": 18, "base_esperanca": 10, "base_aparar": 12, "bonus_escudo": 1,
            "vigor_marcha": 15, "esperanca": 4, "carga": 10, "cansaco": 5, "sombra": 3, "cicatrizes": 1,
            "pericias_favorecidas": ["Furtividade", "Cortesia"]}


def test_one_ring_sheet_derives_tn_maxima_and_states() -> None:
    result = one_ring_sheet(SheetValuesRequest(values=one_ring_values()))
    assert result.derived == {"tn_corpo": 17, "tn_coracao": 14, "tn_astucia": 15, "vigor_max": 21,
                              "esperanca_max": 16, "aparar": 18, "carga_total": 15, "sombra_total": 4}
    assert result.states == {"cansado": True, "miseravel": True, "ferido": False, "surto": False, "inconsciente": False}
    assert result.problems == []


def test_one_ring_sheet_reports_problems_and_migrates_v1_ids() -> None:
    values = {**one_ring_values(), "corpo": 7, "base_vigor": 20, "esperanca": 30, "ferimento_dias": 2,
              "pericias_favorecidas": ["Furtividade", "Cortesia", "Cura", "Enigmas"]}
    problems = one_ring_sheet(SheetValuesRequest(values=values)).problems
    assert any("somam 18" in item for item in problems)
    assert "base_vigor deve ser 18 para Hobbits do Condado" in problems
    assert any(item.startswith("Esperança atual") for item in problems)
    assert "Até 3 perícias favorecidas" in problems
    assert "Dias de ferimento sem a marca Ferido" in problems
    migrated = one_ring_sheet(SheetValuesRequest(values={"forca": 4, "coracao": 5, "espirito": 5, "linhagem": "Bardeses"}, migrate=True))
    assert (migrated.values["corpo"], migrated.values["astucia"], migrated.values["base_vigor"]) == (4, 5, 20)
    assert "forca" not in migrated.values and migrated.warnings == ["forca passou a corpo", "espirito passou a astucia"]


def test_hunter_traits_migrate_legacy_pillars() -> None:
    legacy = {"credo": "inquisitivo", "impulso": "vinganca", "redencao": "x" * 300, "notas": "antigas",
              "pilares": ["Irmã Clara: protejo inocentes", "Nunca mentir (Padre Tomás)", "Só uma frase", "Quarto pilar"]}
    result = hunter_traits(SheetValuesRequest(values=legacy, migrate=True))
    values = result.values
    assert (values["credo"], values["impulso"]) == ("Inquisitivo", "Vingança")
    assert (values["pedra_toque_1"], values["conviccao_1"]) == ("Irmã Clara", "protejo inocentes")
    assert (values["pedra_toque_2"], values["conviccao_2"]) == ("Padre Tomás", "Nunca mentir")
    assert (values["pedra_toque_3"], values["conviccao_3"]) == ("", "Só uma frase")
    assert len(values["redencao"]) == 240 and "pilares" not in values
    assert "Pilar excedente: Quarto pilar" in values["notas"] and values["notas"].startswith("antigas")
    assert "Par 3: preencha Convicção e Pedra de Toque juntas" in result.problems
    assert "Convicção 3 ficou sem Pedra de Toque" in result.warnings


def test_hunter_traits_unknown_drive_goes_to_notes() -> None:
    result = hunter_traits(SheetValuesRequest(values={"credo": "Marcial", "impulso": "Raiva cega"}, migrate=True))
    assert "impulso" not in result.values
    assert "Ímpeto anterior: Raiva cega" in result.values["notas"]
    assert "Escolha um Ímpeto da lista" in result.problems
    complete = {"credo": "Marcial", "impulso": "Juramento", "conviccao_1": "a", "pedra_toque_1": "b", "desespero": 2}
    assert hunter_traits(SheetValuesRequest(values=complete)).problems == []


def test_frente_j_routes_return_results(client, monkeypatch: pytest.MonkeyPatch) -> None:
    force_rolls(monkeypatch, [3, 2])
    assert client.post("/api/v1/system-rolls/one-ring/journey-event", json={"region": "selvagem"}).json()["event"] == "contratempo"
    sheet = client.post("/api/v1/system-rolls/one-ring/sheet", json={"values": one_ring_values()})
    assert sheet.status_code == 200 and sheet.json()["states"]["miseravel"] is True
    traits = client.post("/api/v1/system-rolls/hunter/traits", json={"values": {"pilares": ["A: B"]}, "migrate": True})
    assert traits.json()["values"]["conviccao_1"] == "B"
    force_rolls(monkeypatch, [0, 0])
    shadow = client.post("/api/v1/system-rolls/one-ring/shadow-test", json={
        "source": "feiticaria", "points": 1, "target": 10, "rating": 1, "endurance": 5, "load": 0, "hope": 5, "shadow": 0})
    assert shadow.status_code == 200 and shadow.json()["shadow_gained"] == 1
    assert client.post("/api/v1/system-rolls/one-ring/sheet", json={"values": {}, "extra": 1}).status_code == 422


def test_roll_routes_record_chronicle_activity_in_a_header(client, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str | None, object]] = []

    async def fake_record(authorization, context):
        calls.append((authorization, context))
        return None if context is None else RollActivityResult(status="recorded")

    monkeypatch.setattr(system_rolls_routes, "record_from_context", fake_record)
    sheet_id = "11111111-1111-1111-1111-111111111111"
    for path, body in (("/api/v1/system-rolls/hunter", {"base_pool": 2, "difficulty": 1}),
                       ("/api/v1/system-rolls/one-ring", {"target": 5, "skill_dice": 1, "endurance": 9, "load": 0}),
                       ("/api/v1/system-rolls/shadow-demon-lord", {"attribute": 10})):
        force_rolls(monkeypatch, [5, 5, 5])
        plain = client.post(path, json=body)
        assert plain.status_code == 200 and "X-Chronicle-Activity" not in plain.headers
        force_rolls(monkeypatch, [5, 5, 5])
        recorded = client.post(path, json={**body, "chronicle": {"sheet_id": sheet_id, "trait_ids": ["forca"]}},
                               headers={"Authorization": "Bearer token"})
        assert recorded.status_code == 200
        assert recorded.headers["X-Chronicle-Activity"] == "recorded"
        assert set(recorded.json()) == set(plain.json())
    assert [call[0] for call in calls if call[1] is not None] == ["Bearer token"] * 3
