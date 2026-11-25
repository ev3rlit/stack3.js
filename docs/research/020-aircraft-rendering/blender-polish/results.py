from pathlib import Path
import sys,json,numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageOps
here=Path(__file__).resolve().parent;ref=here.parent/'inputs';raw=Path(sys.argv[1])
target=lambda key:np.asarray(Image.open(ref/(key+'.png')))
def read(k,v):return Image.open(raw/f'{k}-{v}.png').convert('RGBA')
def iou(a,b):return float((a&b).sum()/(a|b).sum())
def color(im):
    bg=Image.new('RGB',im.size,(33,38,43));bg.paste(im,mask=im.getchannel('A'));return bg
report={}
for k in ('source','studio'):
    m=json.loads((raw/(k+'.json')).read_text())
    m['photo_iou']=iou(np.asarray(read(k,'hero'))[...,3]>=128,target('reference-mask')>=128)
    scores={}
    for view in ['top','left','front','rear']:
        pred=np.asarray(read(k,view))[...,3]>=128
        if view!='left':pred=pred[:,::-1]
        ground=target(view)[...,3]>=128;scores[view]=iou(pred,ground)
        if view=='top':
            cols=np.r_[30:121,337:428]
            front=lambda a:np.where(a[:270,cols],np.arange(270)[:,None],-1).max(0)
            m['outboard_leading_edge_median_forward_px']=float(np.median(front(pred)-front(ground)))
    m['ortho_iou']=scores;m['mean_ortho_iou']=float(np.mean(list(scores.values())));report[k]=m
quality=json.loads((raw/'qa.json').read_text())
assert all(d['pass'] for d in quality.values()),[(k,d['errors']) for k,d in quality.items() if not d['pass']]
(here/'qa.json').write_text(json.dumps(quality,indent=2)+'\n')
(here/'measurements.json').write_text(json.dumps(report,indent=2)+'\n')
im=Image.new('RGB',(1660,885),(246,245,240))
def label(x,y,value,size,bold=False):
    f=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',size,index=6 if bold else 0)
    ImageDraw.Draw(im).text((x,y),value,font=f,fill=(33,40,45),anchor='lt')
label(35,24,'Blender 모델링 전후',45,True)
label(36,84,'같은 카메라와 조명에서 촬영한 조립 상태 · 아래는 동일 위치의 주날개와 앞날개 확대',24)
for i,(key,title) in enumerate([('source','복제 원본  ·  아틀라스 메시'),('studio','Blender 수정본  ·  단면 루프 모델링')]):
    x=34+i*809;label(x,143,title,31,True)
    pic=color(read(key,'hero'))
    im.paste(pic.crop((188,55,1248,594)).resize((785,399),Image.Resampling.LANCZOS),(x,192))
    im.paste(pic.crop((545,345,1210,533)).resize((785,222),Image.Resampling.LANCZOS),(x,610))
    label(x,848,f"삼각형 {report[key]['triangles']:,}개    ·    TOP 실루엣 IoU {100*report[key]['ortho_iou']['top']:.2f}%",21)
im.save(here/'comparison.jpg',quality=94,subsampling=0)
color(read('studio','hero')).save(here/'studio-render.png',optimize=True)
print(json.dumps(report))
