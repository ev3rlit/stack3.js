"""Compose contact sheets from the saved renderer buffers, with a shared crop per view."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

here=Path(__file__).resolve().parent
raw=Path(sys.argv[1]); dest=here/'captures'
metrics=json.loads((here/'view-results.json').read_text())
meshes=json.loads((here/'mesh-results.json').read_text())
paper=(245,244,239); ink=(29,37,39); muted=(67,82,82); night=(32,37,42)
names={'z72':'수평','x72':'수직 종단','y72':'수직 횡단','xy72':'수직 종단 + 횡단',
       'zx72':'수평 + 종단','zy72':'수평 + 횡단','xyz72':'세 방향 교차','voxel':'실제 복셀 외피'}
font_path='/System/Library/Fonts/AppleSDGothicNeo.ttc'
def write(im,xy,value,sz,bold=False,color=ink):
    f=ImageFont.truetype(font_path,sz,index=6 if bold else 0)
    ImageDraw.Draw(im).text(xy,value,font=f,fill=color,anchor='lt')
def store(im,key):
    im.save(dest/(key+'.jpg'),quality=94,subsampling=0,optimize=True)
def source(name,mode,view):
    im=Image.open(raw/f'{name}-{mode}-{view}.png').convert('RGBA')
    return im.transpose(Image.Transpose.ROTATE_270) if view=='top' else im
def crop_for(view):
    if view=='photo': return (239,49,1254,545)
    im=source('voxel','voxel',view)
    x0,y0,x1,y1=im.getchannel('A').getbbox()
    return (x0-12,y0-9,x1+12,y1+9)
def still(name,mode,view,dim):
    im=source(name,mode,view).crop(crop_for(view))
    dark=Image.new('RGB',im.size,night)
    dark.paste(im,mask=im.getchannel('A'))
    dark=ImageOps.contain(dark,dim,Image.Resampling.LANCZOS)
    tile=Image.new('RGB',dim,night)
    tile.paste(dark,((dim[0]-dark.width)//2,(dim[1]-dark.height)//2))
    if not im.getchannel('A').getbbox(): write(tile,(15,14),'전경 0 px',21,color=(180,188,189))
    return tile
def heading(im,title,sub):
    write(im,(40,32),title,51,True)
    write(im,(42,110),sub,25,color=muted)

hero=Image.new('RGB',(1740,988),paper)
heading(hero,'단면을 어느 방향으로 쌓을까','같은 항공기 · 같은 사선 카메라 · 스프라이트 총 72장 고정 · 오른쪽 아래는 빈틈을 채운 기준 복셀')
configs=[('z72','높이 방향 72장'),('x72','좌우 방향 72장'),('y72','앞뒤 방향 72장'),
         ('xy72','36 + 36장'),('xyz72','24 + 24 + 24장'),('voxel','151 × 192 × 72 셀')]
for i,(key,spec) in enumerate(configs):
    mode='voxel' if key=='voxel' else 'stack'
    x=40+i%3*562;y=171+i//3*397
    hero.paste(still(key,mode,'photo',(544,277)),(x,y))
    write(hero,(x+1,y+294),names[key],30,True)
    score=metrics[key][mode]['orbit_mean_iou']*100
    note=f'{spec}   ·   16시점 IoU {score:.1f}%' if key!='voxel' else spec+'   ·   비교 기준'
    write(hero,(x+1,y+339),note,22,color=muted)
store(hero,'sprite-directions')

grid=Image.new('RGB',(1694,1028),paper)
heading(grid,'카메라가 단면의 옆날을 볼 때','총 72장 · 각 칸은 WebGL 실측 캡처 · 수치는 같은 시점에서 실제 복셀과 겹친 실루엣 면적(IoU)')
columns=['z72','x72','y72','xy72','xyz72']
for i,key in enumerate(columns):
    write(grid,(128+i*309,177),names[key],26,True)
for j,(view,label) in enumerate([('front','정면'),('side','측면'),('top','위')]):
    y=229+j*258
    write(grid,(40,y+15),label,30,True)
    for i,key in enumerate(columns):
        x=126+i*309
        grid.paste(still(key,'stack',view,(297,185)),(x,y))
        write(grid,(x+2,y+200),f"{metrics[key]['stack']['views'][view]['iou']*100:.1f}%",24,True,color=muted)
store(grid,'orthographic')

comparison=Image.new('RGB',(1580,1154),paper)
heading(comparison,'교차 단면을 메시로 바꾸면','위쪽 두 줄은 두께가 없는 스프라이트 · 아래쪽 두 줄은 같은 단면 사이를 보간한 Marching Cubes 메시')
columns=['z72','xy72','xyz72']
for i,key in enumerate(columns):
    write(comparison,(250+i*437,173),names[key],28,True)
for j,(mode,view,title) in enumerate([('stack','photo','스택  /  사선'),('stack','top','스택  /  위'),
                                     ('mesh','top','메시  /  위'),('mesh','photo','메시  /  사선')]):
    y=220+j*225
    write(comparison,(40,y+22),title,29,True)
    for i,key in enumerate(columns):
        x=249+i*437
        comparison.paste(still(key,mode,view,(423,212)),(x,y))
write(comparison,(249,1122),'모든 열의 총 단면 수는 72장이다. 위에서 본 캡처는 기수가 왼쪽을 향하도록 함께 회전했다.',20,color=muted)
store(comparison,'stack-to-mesh')
# Display the mixed horizontal/vertical variants alongside the two plane-count controls.
budget=Image.new('RGB',(1740,988),paper)
heading(budget,'두 축을 고를 때, 장수를 늘릴 때','위는 총 72장에서 선택한 세 가지 두 축 조합 · 아래는 두 수직 144장과 세 방향 72장 및 216장')
for i,(key,spec) in enumerate([('zx72','수평 36 + 종단 36'),('zy72','수평 36 + 횡단 36'),('xy72','종단 36 + 횡단 36'),
                                ('xy144','종단 72 + 횡단 72'),('xyz72','수평 24 + 종단 24 + 횡단 24'),('xyz216','수평 72 + 종단 72 + 횡단 72')]):
    x=40+i%3*562;y=171+i//3*397
    budget.paste(still(key,'stack','photo',(544,277)),(x,y))
    write(budget,(x+1,y+294),spec,29,True)
    score=metrics[key]['stack']['orbit_mean_iou']*100
    write(budget,(x+1,y+339),f'16시점 IoU  {score:.2f}%',22,color=muted)
store(budget,'crossed')
