from __future__ import annotations

import random
from typing import Any


MIN_DIMENSION = 12
MAX_DIMENSION = 128
MAX_ROOMS = 32


def _validate_request(width: int, height: int, room_count: int, seed: int | str) -> None:
    for name, value in (("width", width), ("height", height), ("room_count", room_count)):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{name} precisa ser um número inteiro")
    if not MIN_DIMENSION <= width <= MAX_DIMENSION:
        raise ValueError(f"width precisa estar entre {MIN_DIMENSION} e {MAX_DIMENSION}")
    if not MIN_DIMENSION <= height <= MAX_DIMENSION:
        raise ValueError(f"height precisa estar entre {MIN_DIMENSION} e {MAX_DIMENSION}")
    if not 1 <= room_count <= MAX_ROOMS:
        raise ValueError(f"room_count precisa estar entre 1 e {MAX_ROOMS}")
    if isinstance(seed, bool) or not isinstance(seed, (int, str)):
        raise ValueError("seed precisa ser um inteiro ou texto")
    if isinstance(seed, str) and (not seed or len(seed) > 128):
        raise ValueError("seed em texto precisa ter entre 1 e 128 caracteres")

    # Each room occupies a separate partition with room for a three-cell
    # interior and a one-cell margin on each side.
    capacity = (width // 5) * (height // 5)
    if room_count > capacity:
        raise ValueError(
            f"room_count excede a capacidade desta dimensão (máximo {capacity})"
        )


def _partition_shape(width: int, height: int, room_count: int) -> tuple[int, int]:
    max_columns = width // 5
    max_rows = height // 5
    candidates = [
        (columns, rows)
        for columns in range(1, max_columns + 1)
        for rows in range(1, max_rows + 1)
        if columns * rows >= room_count
    ]
    return min(
        candidates,
        key=lambda shape: (
            abs((width / shape[0]) - (height / shape[1])),
            shape[0] * shape[1] - room_count,
        ),
    )


def generate_tactical_map(
    *, width: int = 32, height: int = 24, room_count: int = 8, seed: int | str = 0
) -> dict[str, Any]:
    """Gera um documento de mapa versionado, reproduzível e pronto para maps.document."""
    _validate_request(width, height, room_count, seed)
    rng = random.Random(seed)
    columns, rows = _partition_shape(width, height, room_count)
    partition_width = width // columns
    partition_height = height // rows

    rooms: list[dict[str, int | str]] = []
    room_centers: list[tuple[int, int]] = []
    for index in range(room_count):
        grid_x = index % columns
        grid_y = index // columns
        x_start = grid_x * partition_width
        y_start = grid_y * partition_height
        x_end = width if grid_x == columns - 1 else (grid_x + 1) * partition_width
        y_end = height if grid_y == rows - 1 else (grid_y + 1) * partition_height
        available_width = x_end - x_start - 2
        available_height = y_end - y_start - 2
        room_width = rng.randint(3, available_width)
        room_height = rng.randint(3, available_height)
        x = rng.randint(x_start + 1, x_end - room_width - 1)
        y = rng.randint(y_start + 1, y_end - room_height - 1)
        rooms.append({
            "id": f"room-{index + 1}",
            "x": x,
            "y": y,
            "width": room_width,
            "height": room_height,
        })
        room_centers.append((x + room_width // 2, y + room_height // 2))

    room_tiles: set[tuple[int, int]] = set()
    for room in rooms:
        for tile_y in range(int(room["y"]), int(room["y"]) + int(room["height"])):
            for tile_x in range(int(room["x"]), int(room["x"]) + int(room["width"])):
                room_tiles.add((tile_x, tile_y))

    corridors: list[dict[str, Any]] = []
    corridor_tiles: set[tuple[int, int]] = set()
    for index in range(1, room_count):
        parent_index = index - 1 if index % columns else index - columns
        start_x, start_y = room_centers[parent_index]
        end_x, end_y = room_centers[index]
        bend_x_first = bool(rng.getrandbits(1))
        points: list[tuple[int, int]] = [(start_x, start_y)]
        if bend_x_first:
            points.extend(((end_x, start_y), (end_x, end_y)))
        else:
            points.extend(((start_x, end_y), (end_x, end_y)))
        path: list[tuple[int, int]] = []
        for (x1, y1), (x2, y2) in zip(points, points[1:]):
            dx = 0 if x1 == x2 else (1 if x2 > x1 else -1)
            dy = 0 if y1 == y2 else (1 if y2 > y1 else -1)
            x, y = x1, y1
            while (x, y) != (x2, y2):
                if (x, y) not in path:
                    path.append((x, y))
                x += dx
                y += dy
            if (x, y) not in path:
                path.append((x, y))
        corridor_tiles.update(path)
        corridors.append({
            "id": f"corridor-{index}",
            "connects": [f"room-{parent_index + 1}", f"room-{index + 1}"],
            "path": [{"x": x, "y": y} for x, y in path],
        })

    terrain_cells = [
        {
            "x": x,
            "y": y,
            "kind": "room" if (x, y) in room_tiles else "corridor" if (x, y) in corridor_tiles else "wall",
        }
        for y in range(height)
        for x in range(width)
    ]
    return {
        "version": 1,
        "generator": "procedural-tactical-v1",
        "seed": seed,
        "width": width,
        "height": height,
        "grid_kind": "square",
        "layers": [
            {"id": "terrain", "type": "terrain", "cells": terrain_cells},
            {"id": "rooms", "type": "rooms", "items": rooms},
            {"id": "corridors", "type": "corridors", "items": corridors},
        ],
    }
