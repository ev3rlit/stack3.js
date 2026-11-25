"""Render exact alpha masks of an ellipsoid of known volume as a calibration target."""
import sys
import json
from pathlib import Path
import numpy as np
from PIL import Image
from common import ROOT
out=Path(sys.argv[1])
for directory in ['inputs','stack','models']:
    (out/directory).mkdir(parents=True,exist_ok=True)
sizes=json.loads((ROOT/'inputs/registration.json').read_text())['size_pixels']
w,d,h=sizes
meta={'size_pixels':sizes,'views':{}}
for name,(a,b) in zip(('top','left','front','rear'),((w,d),(d,h),(w,h),(w,h))):
    y,x=np.ogrid[:b,:a]
    alpha=((2*(x+.5)/a-1)**2+(2*(y+.5)/b-1)**2<=1)
    rgba=np.zeros((b,a,4),'uint8');rgba[alpha]=[140,140,140,255]
    Image.fromarray(rgba).save(out/'inputs'/f'{name}.png')
    meta['views'][name]=name+'.png'
(out/'inputs/registration.json').write_text(json.dumps(meta))
