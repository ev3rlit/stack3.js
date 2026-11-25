"""Compare matched shots from the original file and the saved variant."""
from pathlib import Path
import json,sys
from PIL import Image,ImageDraw,ImageFont
import numpy as np
here=Path(__file__).resolve().parent;w=Path(sys.argv[1])
def read(k,v):return Image.open(w/f'{k}-{v}.png').convert('RGBA')
def on_dark(im):
    bg=Image.new('RGB',im.size,(32,37,44));bg.paste(im,mask=im.getchannel('A'));return bg
plate=Image.new('RGB',(1580,1006),(247,246,241))
def text(x,y,s,size,bold=False):
    f=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',size,index=6 if bold else 0)
    ImageDraw.Draw(plate).text((x,y),s,font=f,anchor='lt',fill=(32,41,45))
text(35,26,'날개 뿌리와 엔진 덮개의 접합부',47,True)
text(37,91,'같은 기체와 조명 · 하단은 같은 위치를 확대한 Cycles 캡처',24)
for j,(k,t) in enumerate([('before','기존 마감'),('after','접합부와 앞전 수정')]):
    x=34+j*770;text(x,149,t,28,True)
    plate.paste(on_dark(read(k,'hero')).crop((196,46,1256,562)).resize((746,363),Image.Resampling.LANCZOS),(x,195))
    plate.paste(on_dark(read(k,'joint')).resize((746,398),Image.Resampling.LANCZOS),(x,579))
plate.save(here/'comparison.jpg',quality=95,subsampling=0)
on_dark(read('after','hero')).save(here/'aircraft.png',optimize=True)
before=json.loads((w/'before.json').read_text());after=json.loads((w/'after.json').read_text())
a,b=[np.asarray(read(k,'hero'))[...,3]>=128 for k in ('before','after')]
assert np.array_equal(np.load(w/'before-wings.npy'),np.load(w/'after-wings.npy'))
assert before['wing_probe']==after['wing_probe']
(here/'measurements.json').write_text(json.dumps(dict(before=before,after=after,wing_coordinates_identical=True,
    assembled_projection_iou=float((a&b).sum()/(a|b).sum())),indent=2)+'\n')
