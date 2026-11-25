"""Register shallow panel relief to the new wing atlas, in its own local TOP frame."""
from pathlib import Path
import sys
import numpy as np
from scipy import ndimage as nd
from PIL import Image,ImageDraw

out=Path(sys.argv[1]);sz=1024
def image(level):return Image.new('L',(sz,sz),level)
def xy(points):return [(int(x*(sz-1)),int(y*(sz-1))) for x,y in points]
grooves=image(0);brush=ImageDraw.Draw(grooves)
# Trace the two panel break lines and leading-edge trim of the standalone wing TOP.
for line in [[(0,.335),(.30,.283),(.61,.232),(.91,.192)],[(.177,.165),(.177,.305)],
             [(.517,.16),(.517,.25)],[(.88,.16),(.88,.191)],[(.004,.907),(.235,.556),(.905,.284)]]:
    brush.line(xy(line),fill=251,width=3,joint='curve')
field=.65-.40*nd.gaussian_filter(np.asarray(grooves,dtype=float)/255,1.1)
Image.fromarray(np.rint(field*65535).astype('uint16')).save(out/'wing-relief.png')
rough=image(round(.58*255));draw=ImageDraw.Draw(rough)
draw.polygon(xy([(0,.333),(.91,.19),(.91,.15),(0,.162)]),fill=round(.49*255))
draw.polygon(xy([(0,.907),(.235,.556),(.908,.282),(.926,.31),(.26,.618),(.025,1),(0,1)]),fill=round(.31*255))
Image.fromarray(np.rint(nd.gaussian_filter(np.asarray(rough,dtype=float),1.)*257).astype('uint16')).save(out/'wing-roughness.png')
