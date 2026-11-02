import pytest

from app.services.sotdl_progression import validate_sotdl_advance, validate_sotdl_creation


def test_creation_starts_at_zero_without_paths():
    validate_sotdl_creation({"nivel": 0})
    for values in ({"nivel": 1}, {"nivel": True}, {"nivel": 0, "trilha_novato": "Guerreiro"}):
        with pytest.raises(ValueError):
            validate_sotdl_creation(values)


def test_advancement_requires_each_path_at_its_level():
    values = {"nivel": 0}
    for level, new_path in (
        (1, {"trilha_novato": "Guerreiro"}), (2, {}),
        (3, {"trilha_especialista": "Explorador"}), (4, {}), (5, {}), (6, {}),
        (7, {"trilha_mestre": "Sentinela"}), (8, {}), (9, {}), (10, {}),
    ):
        next_values = {**values, **new_path, "nivel": level}
        validate_sotdl_advance(values, next_values)
        values = next_values


@pytest.mark.parametrize("before,after", [
    ({"nivel": 0}, {"nivel": 2, "trilha_novato": "Guerreiro"}),
    ({"nivel": 0}, {"nivel": 1}),
    ({"nivel": 2, "trilha_novato": "Guerreiro"}, {"nivel": 3, "trilha_novato": "Guerreiro"}),
    ({"nivel": 6, "trilha_novato": "Guerreiro", "trilha_especialista": "Explorador"},
     {"nivel": 7, "trilha_novato": "Guerreiro", "trilha_especialista": "Explorador"}),
    ({"nivel": 1, "trilha_novato": "Guerreiro"}, {"nivel": 2, "trilha_novato": "Mago"}),
    ({"nivel": 1, "trilha_novato": "Guerreiro"}, {"nivel": 2, "trilha_novato": "Guerreiro", "trilha_mestre": "Sentinela"}),
    ({"nivel": 10, "trilha_novato": "Guerreiro", "trilha_especialista": "Explorador", "trilha_mestre": "Sentinela"},
     {"nivel": 11, "trilha_novato": "Guerreiro", "trilha_especialista": "Explorador", "trilha_mestre": "Sentinela"}),
])
def test_invalid_advancement_is_rejected(before, after):
    with pytest.raises(ValueError):
        validate_sotdl_advance(before, after)
