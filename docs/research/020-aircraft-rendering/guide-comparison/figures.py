"""Compose registered renderer captures, and sections measured directly in both PNG stacks."""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageOps

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'scripts'))
from common import read_stack
raw=Path(sys.argv[1]); out=HERE/'captures'
scores=json.loads((HERE/'results.json').read_text())
paper=(246,245,241);ink=(34,41,44);muted=(78,88,89);night=(32,37,44)
blue=(112,200,216);amber=(247,165,88)
def text(im,x,y,s,pt,bold=False,color=ink):
    font=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',pt,index=6 if bold else 0)
    ImageDraw.Draw(im).text((x,y),s,font=font,fill=color,anchor='lt')
def title(im,name,subtitle):
    text(im,40,30,name,50,True);text(im,42,105,subtitle,24,color=muted)
def tile(key,dimensions):
    pic=Image.open(raw/(key+'.png')).convert('RGBA')
    if pic.size!=(1280,714):pic=pic.resize((1280,714),Image.Resampling.LANCZOS)
    pic=pic.crop((245,46,1252,545))
    bg=Image.new('RGB',pic.size,night);bg.paste(pic,mask=pic.getchannel('A'))
    bg=ImageOps.contain(bg,dimensions,Image.Resampling.LANCZOS)
    result=Image.new('RGB',dimensions,night)
    result.paste(bg,((dimensions[0]-bg.width)//2,(dimensions[1]-bg.height)//2))
    return result
def save(im,key):
    im.save(out/(key+'.jpg'),quality=94,subsampling=0,optimize=True)

im=Image.new('RGB',(1800,1074),paper)
title(im,'렌더링 방식별 단면 가이드 효과','각 쌍의 왼쪽은 가이드 끔, 오른쪽은 켬 · 같은 정투상 4면, 카메라, 메시 추출법, 삼각형 3,600개')
modes=[('cpu','on','stack3 CPU'),('webgl','on','stack3 WebGL · Lambert'),('eevee','off','무조명 텍스처'),
       ('clay','on','Workbench · 클레이'),('eevee','on','EEVEE · PBR'),('cycles','on','Cycles · 경로 추적')]
for i,(engine,lit,label) in enumerate(modes):
    x=40+i%2*877;y=170+i//2*294
    text(im,x+2,y,label,30,True)
    for j,(guide,glabel) in enumerate([('off','가이드 끔'),('on','가이드 켬')]):
        tx=x+j*430
        im.paste(tile(f'{guide}-{engine}-{lit}',(424,226)),(tx,y+42))
        text(im,tx+12,y+55,glabel,19,True,blue if j else (224,227,224))
save(im,'guide-by-renderer')

im=Image.new('RGB',(1700,766),paper)
title(im,'같은 메시에서 조명을 끄고 켜면','단면 가이드 적용 모델 · 끔은 텍스처 원색 출력, 켬은 해당 렌더러의 재질 조명 적용')
engines=[('cpu','stack3 CPU'),('webgl','stack3 WebGL'),('eevee','EEVEE'),('cycles','Cycles')]
for i,(engine,label) in enumerate(engines):
    x=138+i*384;text(im,x,176,label,28,True)
    for j,lit in enumerate(['off','on']):
        y=232+j*226
        im.paste(tile('on-'+engine+'-'+lit,(375,205)),(x,y))
    a=scores['guides']['on']['engines'][engine]['lighting_change']
    text(im,x+1,685,f"RGB 평균 차이  {a['rgb_mae']:.1f} / 255",22,color=muted)
text(im,36,252,'조명 끔',27,True);text(im,36,479,'조명 켬',27,True)
save(im,'lighting')

im=Image.new('RGB',(1720,956),paper)
title(im,'레이어 방향에 따른 조명 효과','가이드를 적용한 스프라이트 스택 · 각 행 총 72장 · CPU와 WebGL에서 재질 조명을 각각 끄고 켠 실측 화면')
for i,(backend,lit,label) in enumerate([('cpu','off','CPU · 조명 끔'),('cpu','on','CPU · 조명 켬'),
                                        ('webgl','off','WebGL · 조명 끔'),('webgl','on','WebGL · 조명 켬')]):
    x=175+i*378;text(im,x+1,166,label,27,True)
    for j,(key,row) in enumerate([('z72','수평'),('xy72','두 수직'),('xyz72','세 방향')]):
        y=218+j*236
        im.paste(tile(key+'-photo-'+backend+'-'+lit,(371,211)),(x,y))
        if i==0:
            text(im,39,y+26,row,29,True)
            text(im,40,y+75,['72장','36+36장','24장씩'][j],21,color=muted)
save(im,'layers-by-lighting')

im=Image.new('RGB',(1500,758),paper)
title(im,'부위별 단면 가이드는 무엇을 바꾸나','왼쪽 위에서 본 기체를 A와 B 위치에서 가로로 잘랐다. 오른쪽은 저장된 72층 PNG에서 읽은 실제 단면이다.')
plan=Image.open(HERE.parent/'inputs/top.png').convert('RGBA')
plan.thumbnail((350,454),Image.Resampling.LANCZOS)
locator=Image.new('RGB',(408,492),night)
ox=(408-plan.width)//2;oy=(492-plan.height)//2
locator.paste(plan,(ox,oy),plan.getchannel('A'))
rows=[(10,'A',blue),(118,'B',amber)]
for index,letter,color in rows:
    y=oy+round(plan.height*(index+.5)/192)
    ImageDraw.Draw(locator).line((12,y,395,y),fill=color,width=2)
    text(locator,10,max(0,y-24),letter,23,True,color)
im.paste(locator,(40,204))
text(im,45,711,'위에서 본 기체 · 기수는 아래쪽',21,color=muted)
masks=[read_stack(folder)[1][...,3]>=128 for folder in ('stack','section-stack')]
for i,heading in enumerate(['가이드 끔 · 실루엣 교집합','가이드 켬 · 부위별 형상 가정']):
    text(im,480+i*495,171,heading,26,True)
for j,(index,letter,color) in enumerate(rows):
    crops=[d[::-1,index,:] for d in masks]
    ry,rx=np.where(crops[0]|crops[1]); x0=max(0,int(rx.min())-5);x1=min(151,int(rx.max())+6)
    y0=max(0,int(ry.min())-2);y1=min(72,int(ry.max())+3)
    for i,sec in enumerate(crops):
        x=480+i*495;y=216+j*247
        pix=Image.fromarray((sec[y0:y1,x0:x1]*255).astype('uint8'))
        # Native horizontal and vertical voxel pitches differ. Preserve their physical ratio.
        sy=min(165/pix.height,422/pix.width*(1.801029/72)/(4.703259/151))
        sx=sy*(4.703259/151)/(1.801029/72)
        pix=pix.resize((max(1,round(pix.width*sx)),max(1,round(pix.height*sy))),Image.Resampling.NEAREST)
        pane=Image.new('RGB',(474,185),night)
        pane.paste(color if i else (204,211,212),((474-pix.width)//2,(185-pix.height)//2,(474-pix.width)//2+pix.width,(185-pix.height)//2+pix.height),pix)
        im.paste(pane,(x,y))
        note=[['A  배기구 주변에 남은 네 덩어리','A  두 엔진의 둥근 단면'],['B  각진 앞동체 단면','B  타원형으로 잡은 앞동체 단면']][j][i]
        text(im,x+2,y+197,note,22,color=muted)
save(im,'sections')
