"""Compose the measured model turntables and show the registered part atlases."""
import hashlib,json,subprocess,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageOps
root=Path(__file__).parent.resolve()
cache=Path(sys.argv[-1])
font_path='/System/Library/Fonts/AppleSDGothicNeo.ttc'
def font(s):return ImageFont.truetype(font_path,s)
bg='#f5f5f1';ink='#25342e';muted='#57675f'
modes=['single','parts','exploded']
titles=['단일 스택','파츠 조립','파츠 분해도']
W,H=1380,570
plate=Image.new('RGB',(W,H),bg)
d=ImageDraw.Draw(plate)
for i,title in enumerate(titles):
    x=i*460
    d.text((x+24,14),title,font=font(32),fill=ink)
    d.text((x+25,58),['1,600 triangles','1,600 triangles','5종 · 7개 배치'][i],font=font(19),fill=muted)
    if i:d.line((x,18,x,529),fill='#cbd0c7',width=1)
d.line((24,529,W-24,529),fill='#cbd0c7')
d.text((24,536),'병아리    /    무채색 형상 비교',font=font(20),fill=muted)
out=root/'chick-parts-turntable.mp4'
p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','24','-i','-','-an','-c:v','libx264','-crf','17','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart',str(out)],stdin=subprocess.PIPE)
seen=set()
for i in range(96):
    frame=plate.copy()
    for col,mode in enumerate(modes):
        image=ImageOps.mirror(Image.open(cache/mode/f'{i:03}.png').convert('RGBA'))
        frame.paste(image,(460*col,82),image)
        if mode=='parts':seen.add(hashlib.sha256(image.tobytes()).digest())
    ImageDraw.Draw(frame).text((W-24,548),f'{360*i/96:.0f}°',font=font(19),fill=muted,anchor='rm')
    if i==10:frame.save(root/'comparison.jpg',quality=95)
    p.stdin.write(frame.tobytes())
p.stdin.close()
assert p.wait()==0 and len(seen)==96
rows=[('body','몸통'),('wing','날개'),('crest','벼슬'),('beak','부리'),('leg','다리·발')]
sheet=Image.new('RGB',(1130,1158),'#ffffff')
sd=ImageDraw.Draw(sheet)
for i,label in enumerate(['TOP','LEFT','FRONT','REAR']):
    sd.text((184+245*i,14),label,font=font(23),fill=muted)
for j,(part,label) in enumerate(rows):
    y=54+j*219
    sd.line((22,y,1108,y),fill='#d3d7d0')
    sd.text((22,y+92),label,font=font(27),fill=ink)
    tiles=[Image.open(root/part/(k+'.png')).convert('RGBA') for k in ('top','left','front','rear')]
    scale=min(202/max(im.width for im in tiles),183/max(im.height for im in tiles))
    for i,im in enumerate(tiles):
        tile=im.resize((max(1,round(im.width*scale)),max(1,round(im.height*scale))),Image.Resampling.LANCZOS)
        sheet.paste(tile,(140+245*i+(205-tile.width)//2,y+15+(183-tile.height)//2),tile)
sheet.save(root/'part-atlases.jpg',quality=94)
