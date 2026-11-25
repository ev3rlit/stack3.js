"""Two scalar test maps registered to the previous TOP image, in its pixel coordinates."""
from pathlib import Path
import sys
import numpy as np
from PIL import Image,ImageDraw
from scipy import ndimage as nd

out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
scale=3
w,h=457,583
def sheet(value):
    return Image.new('L',(w*scale,h*scale),value)
def scaled(points): return [(round(x*scale),round(y*scale)) for x,y in points]
def line(image,points,value,width):
    ImageDraw.Draw(image).line(scaled(points),fill=value,width=max(1,round(width*scale)),joint='curve')
def polygon(image,points,value):
    ImageDraw.Draw(image).polygon(scaled(points),fill=value)
def mirrored(points): return [(451.8-x,y) for x,y in points]

# Follow the large visible seams on the source wing and use a few authored fasteners.
base=sheet(0)
paths=[[(16,82),(80,92),(136,101),(150,94)],[(80,92),(77,130)],
       [(140,107),(137,160)],[(11,106),(75,139),(131,167),(164,224)],
       [(19,74),(18,82)],[(84,74),(83,91)],[(140,74),(139,98)]]
rough=sheet(round(.62*255))
for reflect in [False,True]:
    orient=mirrored if reflect else lambda p:p
    polygon(rough,orient([(20,74),(134,74),(135,99),(20,80)]),round(.39*255))
    polygon(rough,orient([(11,103),(132,164),(163,223),(131,172),(10,111)]),round(.30*255))
    polygon(rough,orient([(179,7),(215,6),(216,37),(177,37)]),round(.32*255))
    for path in paths:
        line(base,orient(path),255,1.05)
    draw=ImageDraw.Draw(base)
    for x,y in orient([(25,85.5),(46,89),(68,92),(88,96),(109,99),(129,102),
                      (83,100),(82,112),(81,124)]):
        r=.80; draw.ellipse([round((x-r)*scale),round((y-r)*scale),round((x+r)*scale),round((y+r)*scale)],fill=225)
# Canopy ID from its outline; leave the dark transverse frame in body paint.
canopy=[(208,326),(214,318),(222,315),(231,316),(240,324),(243,342),
        (243,390),(239,414),(233,426),(226,430),(217,424),(211,410),(207,388),(206,350)]
polygon(rough,canopy,round(.14*255))
line(rough,[(207,380),(222,378),(242,379)],round(.62*255),3.4)
rough_array=nd.gaussian_filter(np.asarray(rough,dtype=float),.5*scale)
height=.70-.58*nd.gaussian_filter(np.asarray(base,dtype=float)/255,.43*scale)
for name,field in [('roughness',rough_array/255),('panel-height',height)]:
    Image.fromarray(np.rint(np.clip(field,0,1)*65535).astype('uint16')).save(out/(name+'.png'))
