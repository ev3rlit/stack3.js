"""Assemble the fixed-camera pairs and measure mask changes in each view."""
import json
from pathlib import Path
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

dst=Path(__file__).resolve().parent
raw=Path(sys.argv[1])
dark=(32,38,43); paper=(247,246,242); ink=(30,38,41);muted=(72,84,85)
def label(canvas,x,y,words,size,bold=False):
    f=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',size,index=6 if bold else 0)
    ImageDraw.Draw(canvas).text((x,y),words,font=f,fill=ink if bold else muted,anchor='lt')
def read(name):
    return Image.open(raw/(name+'.png')).convert('RGBA')
def render_cell(canvas,shot,box):
    pic=read(shot); bg=Image.new('RGB',pic.size,dark)
    bg.paste(pic,mask=pic.getchannel('A'))
    x,y,w,h=box
    if bg.size==(1280,714):bg=bg.crop((240,48,1250,548))
    bg.thumbnail((w,h),Image.Resampling.LANCZOS)
    ImageDraw.Draw(canvas).rectangle((x,y,x+w-1,y+h-1),fill=dark)
    canvas.paste(bg,(x+(w-bg.width)//2,y+(h-bg.height)//2))
def mask_iou(a,b):
    a=np.asarray(read(a))[...,3]>=128;b=np.asarray(read(b))[...,3]>=128
    return float((a&b).sum()/(a|b).sum())
dist=json.loads((raw/'section.json').read_text())
ratio=dist['combined']/dist['base']
pairs=[('base-canopy','roughness-canopy'),('base-panel','bump-panel'),('base-edge','thickness-edge'),('base-edge','bump-edge'),('base-edge','combined-edge'),('base-hero','combined-hero')]
stats={v:mask_iou(k,v) for k,v in pairs}
assert ratio==1 and stats['combined-edge']==stats['combined-hero']==1
im=Image.new('RGB',(1600,1158),paper)
label(im,36,27,'캐노피의 반사, 패널 홈, 날개의 두께',50,True)
label(im,38,98,'같은 항공기, 같은 카메라와 조명. 마지막 행에서 두 재질 효과를 함께 적용한 날개 단면을 확인했다.',23)
for i,(title,description,a,b) in enumerate([
    ('거칠기','캐노피의 거칠기를 0.48에서 0.14로 낮추면 밝은 반사 띠의 경계가 또렷해진다.','base-canopy','roughness-canopy'),
    ('범프','원래 패널선을 따라 만든 높이 맵이 홈 양쪽의 명암을 가른다.','base-panel','bump-panel'),
    ('날개 단면','거칠기와 범프를 적용한 뒤에도 날개 중간 지점의 두께는 %.2f배다.'%ratio,'base-edge','combined-edge')]):
    y=151+i*325
    label(im,38,y,title,33,True);label(im,234,y+6,description,24)
    for j,(key,tag) in enumerate([(a,'기본'),(b,'적용')]):
        x=38+j*770
        render_cell(im,key,(x,y+45,752,248))
        font=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',21,index=6)
        d=ImageDraw.Draw(im);d.rectangle((x+8,y+53,x+74,y+85),fill=dark)
        d.text((x+19,y+60),tag,font=font,fill=(240,242,238),anchor='lt')
im.save(dst/'detail-comparison.jpg',quality=94,subsampling=0)
whole=Image.new('RGB',(1598,525),paper)
label(whole,35,30,'기본 재질',38,True);label(whole,811,30,'부위별 거칠기 + 패널 범프',36,True)
for j,key in enumerate(['base-hero','combined-hero']):
    render_cell(whole,key,(35+j*778,96,748,392))
whole.save(dst/'whole-aircraft.jpg',quality=94,subsampling=0)
profile=Image.new('RGB',(1598,855),paper)
profile.paste(whole,(0,0))
label(profile,35,513,'날개 정면 확대',36,True)
label(profile,362,521,'같은 지점의 두께 0.1313 → 0.1313 장면 단위',25)
for j,key in enumerate(['base-edge','combined-edge']):
    render_cell(profile,key,(35+j*778,574,748,250))
profile.save(dst/'wing-profile.jpg',quality=94,subsampling=0)
(dst/'measurements.json').write_text(json.dumps({'triangles':3600,'section_in_scene_units':dist,
    'measured_thickness_ratio':ratio,'thickness_demo_ratio':dist['thickness']/dist['base'],'silhouette_iou_vs_baseline_same_view':stats},indent=2)+'\n')
print(ratio,stats)
