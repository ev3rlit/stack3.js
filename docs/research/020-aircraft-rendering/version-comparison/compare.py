"""Make a same-camera visual comparison and score both versions against the same masks."""
from pathlib import Path
import sys,json
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageOps
here=Path(__file__).resolve().parent; inp=here.parent/'inputs'; out=Path(sys.argv[1])
metrics=json.loads((out/'geometry.json').read_text())
def read_mask(path):
    a=np.array(Image.open(path))
    return (a[...,3] if a.ndim==3 else a)>=128
def iou(a,b):
    return float((a&b).sum()/(a|b).sum())
def alpha(name,angle):
    a=read_mask(out/f'{name}-{angle}.png')
    return a[:,::-1] if angle in ('top','front','rear') else a
target=read_mask(inp/'top.png');yy,xx=np.ogrid[:583,:457]
zones={'outer_main_wing':(abs(xx-225.9)>105)&(yy>35)&(yy<273),
       'outboard_canard':(abs(xx-225.9)>44)&(yy>=273)&(yy<354)}
for name,m in metrics.items():
    m['photo_iou']=iou(alpha(name,'photo'),read_mask(inp/'reference-mask.png'))
    m['ortho_iou']={v:iou(alpha(name,v),read_mask(inp/f'{v}.png')) for v in ('top','left','front','rear')}
    m['mean_ortho_iou']=float(np.mean(list(m['ortho_iou'].values())))
    top=alpha(name,'top')
    m['top_region_iou']={zone:iou(top&mask,target&mask) for zone,mask in zones.items()}
    # In TOP the positive row axis points toward the nose. Use the leading edge at a fixed span.
    cols=np.r_[30:121,337:428]
    leading=lambda a:np.max(np.where(a[:270,cols],np.arange(270)[:,None],-1),axis=0)
    m['outboard_leading_edge_median_forward_px']=float(np.median(leading(top)-leading(target)))
(here/'measurements.json').write_text(json.dumps(metrics,indent=2)+'\n')
paper=(247,246,242);ink=(33,41,45);muted=(67,83,89);bg=(34,39,45)
def label(im,x,y,s,pt,bold=False):
    f=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',pt,index=6 if bold else 0)
    ImageDraw.Draw(im).text((x,y),s,font=f,fill=ink if bold else muted,anchor='lt')
def foreground(pic):
    pic=pic.convert('RGBA');base=Image.new('RGB',pic.size,bg);base.paste(pic,mask=pic.getchannel('A'));return base
def fit(pic,size):
    pic=ImageOps.contain(pic,size,Image.Resampling.LANCZOS)
    tile=Image.new('RGB',size,bg);tile.paste(pic,((size[0]-pic.width)//2,(size[1]-pic.height)//2))
    return tile
im=Image.new('RGB',(1640,786),paper)
label(im,35,25,'이전 가이드 모델과 현재 파츠 모델',48,True)
label(im,37,91,'같은 조립 자세, 같은 카메라와 조명. 아래는 위에서 본 날개와 앞날개의 윤곽이다.',24)
for col,(key,title) in enumerate([(None,'원본 이미지'),('old','이전  ·  단일 아틀라스'),('new','현재  ·  부품별 아틀라스')]):
    x=35+col*531
    label(im,x,151,title,28,True)
    pic=Image.open(inp/'reference.jpg') if key is None else foreground(Image.open(out/f'{key}-photo.png'))
    im.paste(fit(pic.crop((105,48,1269,638)),(514,262)),(x,195))
    # Crop the same registered TOP region in all three columns to compare the two wing roots.
    top=target if not key else alpha(key,'top')
    colors=np.full((*target.shape,3),bg,np.uint8)
    colors[top&target]=[182,193,193];colors[target&~top]=[68,194,214];colors[top&~target]=[245,151,76]
    tile=Image.fromarray(colors).crop((0,36,457,355))
    im.paste(fit(tile,(514,233)),(x,480))
    if key:
        label(im,x,731,f"사진 IoU  {metrics[key]['photo_iou']*100:.2f}%",24,True)
    else:
        label(im,x,731,'윗면 기준 · 기존 전체 4면도의 TOP',21)
for x,color,txt in [(882,(68,194,214),'기준에만 있음'),(1091,(245,151,76),'모델에만 있음'),(1317,(182,193,193),'공통 영역')]:
    ImageDraw.Draw(im).rectangle((x,105,x+16,121),fill=color);label(im,x+22,101,txt,18)
im.save(here/'comparison.jpg',quality=95,subsampling=0)
