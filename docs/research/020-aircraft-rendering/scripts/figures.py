"""Lay out photographic comparisons using only actual renderer output."""
from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from common import ROOT, NAMES

raw=Path(sys.argv[1]); out=ROOT/'captures'; out.mkdir(exist_ok=True)
metrics=json.loads((ROOT/'results.json').read_text())
models=metrics['models']
paper=(246,245,241); ink=(34,40,44); dim=(79,90,95)
rule=(204,209,206); night=(35,40,47)
font_path='/System/Library/Fonts/AppleSDGothicNeo.ttc'
def font(size,bold=False):
    return ImageFont.truetype(font_path,size,index=6 if bold else 0)
def label(im,xy,text,size,bold=False,fill=ink):
    ImageDraw.Draw(im).text(xy,text,font=font(size,bold),fill=fill,anchor='lt')
def native(name):
    return Image.open(raw/(name+'.png')).convert('RGBA')
def background(im,rgb=night):
    base=Image.new('RGBA',im.size,(*rgb,255));base.alpha_composite(im)
    return base.convert('RGB')
def panel(im,box,size):
    return ImageOps.contain(im.crop(box),size,Image.Resampling.LANCZOS)
def frame(im,box,size,bg=night):
    cropped=panel(im,box,size)
    canvas=Image.new('RGB',size,bg)
    canvas.paste(cropped,((size[0]-cropped.width)//2,(size[1]-cropped.height)//2))
    return canvas
def publish(im,name):
    im.save(out/(name+'.jpg'),quality=93,subsampling=0,optimize=True)
def head(title,subtitle,rows=2):
    image=Image.new('RGB',(1792,168+rows*415+36),paper)
    label(image,(42,32),title,54,True)
    label(image,(44,106),subtitle,25,fill=dim)
    return image
def place(sheet,index,pic,title,caption,box,filter_bg=night):
    x=40+(index%3)*575; y=166+(index//3)*415
    sheet.paste(frame(pic,box,(560,287),filter_bg),(x,y))
    label(sheet,(x+2,y+307),title,31,True)
    label(sheet,(x+2,y+353),caption,22,fill=dim)
    ImageDraw.Draw(sheet).line((x,y+392,x+560,y+392),fill=rule,width=2)

# All six renderer images use identical world framing. Resample CPU's capped buffer once.
sheet=head('같은 메시, 여섯 가지 렌더링','단면 가이드 모델   ·   삼각형 3,600개   ·   동일 카메라   ·   RGB 차이는 Cycles 대비 전경 채널 평균')
looks=[('cpu','stack3 CPU','소프트웨어 래스터화'),('webgl','stack3 WebGL','Lambert 확산광'),('unlit','무조명 텍스처','EEVEE 발광 셰이더'),
       ('clay','클레이','Workbench 스튜디오'),('eevee','EEVEE','실시간 PBR'),('cycles','Cycles','경로 추적')]
crop=(215,37,1262,557)
for i,(k,title,desc) in enumerate(looks):
    im=native('section-loft-'+k)
    if im.size!=(1280,714): im=im.resize((1280,714),Image.Resampling.LANCZOS)
    err=metrics['renderer_difference'][k]['rgb_mae_8bit']
    caption=desc+('   ·   비교 기준' if k=='cycles' else f'   ·   RGB 차이 {err:.1f} / 255')
    place(sheet,i,background(im),title,caption,crop)
publish(sheet,'renderers')

sheet=head('같은 이미지에서 복원한 기체','원본 사진과 다섯 가지 메시   ·   모델은 EEVEE로 촬영   ·   고정 카메라에서 사진 실루엣 IoU 측정')
photo=Image.open(ROOT/'inputs/reference.jpg').convert('RGB')
# Extend the source photograph and every render to exactly the same physical frame.
box=(110,49,1270,626)
place(sheet,0,photo,'원본 사진','제공된 사선 시점',box,(30,32,36))
titles=['복셀 경계면','Marching Cubes','Surface Nets','Surface Nets + QEM','부위별 단면 가이드']
for i,(n,title) in enumerate(zip((*NAMES,'section-loft'),titles),1):
    m=models[n]
    place(sheet,i,background(native(n+'-eevee')),title,
          f"삼각형 {m['triangles']:,}개   ·   사진 IoU {m['photo_iou']*100:.1f}%",box)
publish(sheet,'meshes')

# Mask overlay and visual-hull failure close-up on a common camera crop.
detail=Image.new('RGB',(1656,950),paper)
label(detail,(40,32),'꼬리 형상과 윤곽 오차',50,True)
label(detail,(42,102),'위쪽은 꼬리날개 확대, 아래쪽은 단면 가이드 모델과 원본 사진의 실루엣을 포갠 결과',25,fill=dim)
for i,(im,title) in enumerate([(photo,'원본 사진'),(background(native('marching-cubes-clay')),'기존 Marching Cubes'),(background(native('section-loft-clay')),'부위별 단면 가이드')]):
    x=40+535*i
    detail.paste(frame(im,(699,65,1123,358),(509,257)),(x,154))
    label(detail,(x,428),title,25,True)
source=np.array(Image.open(ROOT/'inputs/reference-mask.png'))>127
pred=np.array(native('section-loft-eevee'))[...,3]>=128
color=np.full((*source.shape,3),night,np.uint8)
palette=[(191,202,201),(85,195,211),(250,158,87)]
for m,c in zip((source&pred,source&~pred,pred&~source),palette): color[m]=c
detail.paste(frame(Image.fromarray(color),box,(968,441)),(40,488))
label(detail,(1050,511),'사진과 모델의 겹침',32,True)
for i,t in enumerate(['공통 영역','사진에만 있는 영역','메시에만 있는 영역']):
    y=581+52*i
    ImageDraw.Draw(detail).rectangle((1052,y,1070,y+18),fill=palette[i])
    label(detail,(1087,y-2),t,25)
m=models['section-loft']
label(detail,(1050,766),f"실루엣 IoU    {m['photo_iou']*100:.2f}%",31,True)
label(detail,(1050,824),f"윤곽 거리 95백분위    {m['photo_boundary_p95_px']:.1f}px",24,fill=dim)
publish(detail,'silhouette')

# Keep the full studio still plus a twelve-angle contact sheet and the live stack viewer.
hero=background(native('section-loft-cycles'))
hero.save(out/'aircraft-cycles.png',optimize=True)
orbit=Image.new('RGB',(1600,866),paper)
label(orbit,(34,22),'단면 가이드 모델 회전 캡처',42,True)
for i in range(12):
    pic=background(native(f'orbit-{i:02d}')).resize((380,244),Image.Resampling.LANCZOS)
    x=34+(i%4)*389;y=85+(i//4)*257
    orbit.paste(pic,(x,y));label(orbit,(x+10,y+10),f'{30*i}°',17,fill=(220,226,227))
publish(orbit,'orbit')
stacks=Image.new('RGB',(1584,644),paper)
label(stacks,(38,32),'메시화 전의 스프라이트 스택',46,True)
label(stacks,(40,96),'저장한 PNG 레이어를 stack3 WebGL에서 다시 연 화면   ·   151 × 192픽셀   ·   높이 72층',25,fill=dim)
for i,(key,title) in enumerate([('stack','4면 실루엣 교집합'),('section-stack','부위별 단면 가이드')]):
    x=38+i*763
    pic=background(native('section-loft-'+key))
    stacks.paste(frame(pic,crop,(744,380)),(x,157))
    label(stacks,(x+2,566),title,32,True)
publish(stacks,'stacks')
