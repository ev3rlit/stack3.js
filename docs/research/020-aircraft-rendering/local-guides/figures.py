"""Compose the actual matched renders; display their common full frames without repositioning."""
from pathlib import Path
import sys
from PIL import Image,ImageDraw,ImageFont

here=Path(__file__).resolve().parent
raw=Path(sys.argv[1]);out=here/'captures';out.mkdir(exist_ok=True)
paper=(247,246,242);ink=(35,42,44);muted=(70,83,85);night=(32,37,44)
def label(im,x,y,text,size,bold=False):
    font=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',size,index=6 if bold else 0)
    ImageDraw.Draw(im).text((x,y),text,font=font,fill=ink if bold else muted,anchor='lt')
def source(key):
    im=Image.open(raw/(key+'.png')).convert('RGBA')
    bg=Image.new('RGB',im.size,night);bg.paste(im,mask=im.getchannel('A'))
    return bg
def panel(clay=False):
    im=Image.new('RGB',(1490,1020),paper)
    label(im,38,30,'흡입구와 배기구 단면 비교' if not clay else '재질을 제거한 엔진 단면 비교',49,True)
    label(im,40,105,'같은 외형과 카메라 · 엔진 네 곳에만 오목한 단면을 추가했다.' if not clay else '동일한 단색 재질과 카메라에서 내부 벽과 바닥의 형상을 확인했다.',25)
    for col,(variant,title) in enumerate([('before','기존 부위별 단면'),('after','오목한 단면 추가')]):
        x=40+col*711
        label(im,x,159,title,32,True)
        for row,area in enumerate(('intake','outlet')):
            key=f'{variant}-{area}'+('-clay' if clay else '')
            tile=source(key).resize((696,348),Image.Resampling.LANCZOS)
            y=211+row*388
            im.paste(tile,(x,y))
            label(im,x+2,y+359,'위쪽 흡입구' if row==0 else '뒤쪽 배기구',22)
    im.save(out/('clay.jpg' if clay else 'engine-details.jpg'),quality=94,subsampling=0)
panel()
panel(True)
hero=source('after-hero')
hero.save(out/'aircraft.png',optimize=True)
