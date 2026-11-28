"""Compare the corrected native LEFT mask with a true lateral projection of the delivered crest."""
from pathlib import Path
import json,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from scipy.signal import find_peaks

root=Path(__file__).resolve().parents[1];folder=root/'crest'
src=Image.open(folder/'left.png').convert('RGBA')
old=Image.open(folder/'left-v1.png').convert('RGBA')
w,h=src.size
data=np.load(Path(sys.argv[1])/'parts-Crest.npz')
pts=data['v']; y,z=pts[:,1],pts[:,2]
pixels=np.column_stack((1-(y-y.min())/np.ptp(y),1-(z-z.min())/np.ptp(z)))*[w*2,h*2]
mask=Image.new('L',(2*w,2*h));draw=ImageDraw.Draw(mask)
for tri in np.rint(pixels[data['f']]-.5).astype(int):
    draw.polygon(tri.ravel().tolist(),fill=255)
mask=mask.resize((w,h),Image.Resampling.BOX)
m=np.asarray(mask)>=128
def peaks(binary):
    height=1-np.argmax(binary,axis=0)/binary.shape[0]
    ids,_=find_peaks(height,prominence=.015)
    return [(round((i+.5)/binary.shape[1],3),round(float(height[i]),3)) for i in ids]
a=np.asarray(src)[...,3]>=128
b=np.asarray(old)[...,3]>=128
result=dict(before_apices=peaks(b),corrected_apices=peaks(a),mesh_apices=peaks(m),
            fitted_side_iou=float(np.count_nonzero(m&a)/np.count_nonzero(m|a)))
print(result)
(folder/'left-check.json').write_text(json.dumps(result,indent=2)+'\n')
font=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',24)
plate=Image.new('RGB',(1080,320),'#fafaf7')
d=ImageDraw.Draw(plate)
orig=Image.open(root.parent/'section-study/views/left.png').convert('RGBA').crop((155,0,288,84))
for i,(label,img) in enumerate([('전체 병아리 LEFT',orig),('수정 전',old),('수정 후',src)]):
    img.thumbnail((290,225),Image.Resampling.LANCZOS)
    if i==0:img=img.resize((290,183),Image.Resampling.LANCZOS)
    d.text((i*360+22,16),label,font=font,fill='#29342d')
    plate.paste(img,(i*360+(360-img.width)//2,74+(225-img.height)//2),img)
plate.save(folder/'left-comparison.jpg',quality=95)
