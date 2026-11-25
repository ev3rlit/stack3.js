"""Show the actual input atlas pixels and renders of the re-opened Blender delivery."""
from pathlib import Path
import json,sys,zipfile
from PIL import Image,ImageDraw,ImageFont,ImageOps

here=Path(__file__).resolve().parent; work=Path(sys.argv[1]);out=here/'captures'
spec=json.loads((here/'calibration.json').read_text())
paper=(246,245,241);ink=(30,39,42);dim=(72,86,88);night=(32,37,44)
def label(im,x,y,value,points,bold=False):
    font=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',points,index=6 if bold else 0)
    ImageDraw.Draw(im).text((x,y),value,font=font,fill=ink if bold else dim,anchor='lt')
def rgb(im,color):
    bg=Image.new('RGB',im.size,color);bg.paste(im,mask=im.getchannel('A'));return bg
def publish(im,n):
    im.save(out/(n+'.jpg'),quality=94,subsampling=0,optimize=True)
names={'fuselage':'동체','canopy':'캐노피','nacelle':'엔진 덮개','wing':'주날개','fin':'꼬리날개','canard':'앞날개'}
order=['fuselage','canopy','nacelle','wing','fin','canard']
atlas=Image.new('RGB',(1540,1278),paper)
label(atlas,36,27,'부품별로 만든 4면 아틀라스',48,True)
label(atlas,38,96,'한 행이 독립 입력 PNG 한 장이다. 각 칸은 원본 비율을 유지해 보기 좋게 확대한 것이다.',24)
cols=[('top','TOP  ·  위'),('left','LEFT  ·  측면'),('front','FRONT  ·  정면'),('rear','REAR  ·  후면')]
for col,(_,name) in enumerate(cols):label(atlas,248+col*317,153,name,24,True)
for row,k in enumerate(order):
    src=Image.open(here/'atlases'/f'{k}.png').convert('RGBA');y=205+row*176
    label(atlas,38,y+35,names[k],30,True)
    label(atlas,39,y+80,k+'.png',19)
    for col,(direction,_) in enumerate(cols):
        x0,y0,w,h=spec[k]['views'][direction]
        p=rgb(src.crop((x0,y0,x0+w,y0+h)),(255,255,255))
        p=ImageOps.contain(p,(278,139),Image.Resampling.LANCZOS)
        x=235+col*317;tile=Image.new('RGB',(309,158),'white')
        tile.paste(p,((309-p.width)//2,(158-p.height)//2));atlas.paste(tile,(x,y))
publish(atlas,'input-atlases')
sheet=Image.new('RGB',(1700,712),paper)
label(sheet,37,30,'독립 아틀라스로 조립한 항공기',48,True)
label(sheet,40,100,'Blender에서 다시 연 같은 파일 · 왼쪽 0프레임, 오른쪽 48프레임 · 분해 뷰에서는 카메라 범위도 넓어짐',23)
for i,(k,name) in enumerate([('assembled','조립'),('exploded','분해')]):
    im=rgb(Image.open(work/('blend-'+k+'.png')).convert('RGBA'),night)
    x=38+i*821;sheet.paste(im.resize((804,483),Image.Resampling.LANCZOS),(x,162))
    label(sheet,x+1,663,name,29,True);publish(im,k)
publish(sheet,'assembly')
with zipfile.ZipFile(here/'six-atlases.zip','w',compression=zipfile.ZIP_STORED) as z:
    for key in order:z.write(here/'atlases'/f'{key}.png',key+'.png')
