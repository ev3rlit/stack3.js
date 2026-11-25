"""Shared coordinate system: X across, Y from tail to nose, Z up, origin at the grid base."""
from pathlib import Path
import json
import os

import numpy as np
from PIL import Image

ROOT = Path(os.environ.get('STACK3_BENCH_ROOT', Path(__file__).resolve().parents[1]))
NAMES = ('voxel', 'marching-cubes', 'surface-nets', 'surface-nets-qem')

def read_stack(folder="stack"):
    m = json.loads((ROOT/folder/'stack.json').read_text())
    atlas = np.asarray(Image.open(ROOT/folder/'stack.png'))
    w, d, h, c = (m[k] for k in ('width','depth','layers','columns'))
    tiles = atlas.reshape(-1,d,c,w,4).transpose(0,2,1,3,4).reshape(-1,d,w,4)[:h]
    return m, tiles

def save_json(path, data):
    path.write_text(json.dumps(data, indent=2, allow_nan=False)+'\n')
