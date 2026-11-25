"""Registered cosmetic panel break, in reference-image coordinates (span, longitudinal row)."""
from pathlib import Path
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt
out=Path(sys.argv[1]);scale=8
w,h=80,170
base=Image.new('L',(w*scale,h*scale))
def pixels(coords):return [(round(r*scale),round((y-60)*scale)) for r,y in coords]
path=[(8,88),(29,94),(39.5,96.5),(50,110),(58,119),(75,124)]
ImageDraw.Draw(base).line(pixels(path),fill=255,width=2)
dist=distance_transform_edt(np.asarray(base)==0)/scale
groove=np.exp(-.5*(dist/.40)**2)
shoulder=np.exp(-.5*((dist-.72)/.27)**2)
for name,f in [('joint-height',.62-.48*groove+.055*shoulder),('joint-color',1-.69*groove)]:
    if name=='joint-color': f=1.055*f**(1/2.4)-.055
    Image.fromarray(np.rint(65535*np.clip(f,0,1)).astype('uint16')).save(out/(name+'.png'))
