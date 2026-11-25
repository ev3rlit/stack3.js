"""Isolate the four connected silhouettes and align them in plan-pixel units."""
from pathlib import Path
import json

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / 'inputs'
im = np.array(Image.open(INPUT / 'four-views.png').convert('RGB'))
_, labels, stats, _ = cv2.connectedComponentsWithStats((im.min(axis=2) < 226).astype('uint8'))
regions = sorted((i for i in range(1, len(stats)) if stats[i, 4] > 2000), key=lambda i: stats[i, 0])
assert len(regions) == 4
width, length = map(int, stats[regions[0], 2:4])
height, wing_row = 175, 124
meta = {'size_pixels': [width, length, height], 'views': {}, 'registration': {}}
# Use a mid-span wing section to align elevations. All resizes are uniform.
for name, label, anchor in zip(('top', 'left', 'front', 'rear'), regions, (0, 384, 366, 369)):
    x, y, w, h = map(int, stats[label, :4])
    rgba = np.dstack((im, 255 * (labels == label).astype('uint8')))
    tile = Image.fromarray(rgba[y:y+h, x:x+w])
    if name == 'top':
        scale, offset = 1., 0
    else:
        target = length if name == 'left' else width
        scale = target / w
        offset = round(wing_row - (anchor-y)*scale)
        resized = tile.resize((target, round(h*scale)), Image.Resampling.LANCZOS)
        assert 0 <= offset <= height-resized.height
        tile = Image.new('RGBA', (target, height))
        tile.paste(resized, (0, offset))
    tile.save(INPUT / f'{name}.png')
    meta['views'][name] = f'{name}.png'
    meta['registration'][name] = dict(source_bbox=[x,y,w,h], scale=scale, y_offset=offset)
(INPUT/'registration.json').write_text(json.dumps(meta, indent=2)+'\n')
