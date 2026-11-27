"""Read an authored signed distance field aligned to the saved occupancy."""

from pathlib import Path

import numpy as np


def load_field(occupied, name, directory):
    if not isinstance(name, str) or not name or not directory:
        raise ValueError("field must be a .npy path relative to the guide")
    path = Path(directory) / name
    if path.suffix.lower() != ".npy":
        raise ValueError("field must be a .npy path")
    field = np.load(path, allow_pickle=False)
    if not isinstance(field, np.ndarray) or field.shape != occupied.shape or field.dtype.kind != "f" or not np.isfinite(field).all():
        raise ValueError(f"field must be a finite XYZ float array of padded shape {occupied.shape}")
    if not np.array_equal(field < 0, occupied) or np.any(field == 0):
        raise ValueError("field signs must match the saved stack at all padded cell centers")
    return field.astype(np.float64, copy=False)
