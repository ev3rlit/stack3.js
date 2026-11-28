"""Encode the turntable and present the six independently registered part atlases."""
import json,subprocess,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parent
frames=Path(sys.argv[-1])
for i in range(72):assert (frames/f'{i:03}.png').is_file()
mp4=root/'hen-turntable.mp4'
subprocess.run(['ffmpeg','-v','error','-y','-framerate','24','-start_number','0','-i',str(frames/'%03d.png'),'-frames:v','72','-an','-c:v','libx264','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(mp4)],check=True)
subprocess.run(['ffmpeg','-v','error','-y','-i',str(mp4),'-vf','fps=12,scale=448:448:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=bayer:bayer_scale=4','-loop','0',str(root/'hen-turntable.gif')],check=True)
canvas=Image.new('RGB',(1020,1150),'#ece9e7');d=ImageDraw.Draw(canvas);font='/System/Library/Fonts/AppleSDGothicNeo.ttc'
for i,n in enumerate(['TOP','LEFT','FRONT','REAR']):d.text((180+i*212,12),n,font=ImageFont.truetype(font,19),fill='#453f42')
for j,(part,title) in enumerate([('body','몸통'),('comb','볏'),('wattle','육수'),('wing','날개'),('beak','부리'),('foot','다리·발')]):
    y=44+182*j;d.line((18,y,998,y),fill='#c8c2c2');d.text((22,y+75),title,font=ImageFont.truetype(font,24),fill='#453f42')
    views=[Image.open(root/part/(n+'.png')).convert('RGBA') for n in ('top','left','front','rear')]
    ratio=min(184/max(im.width for im in views),156/max(im.height for im in views))
    for i,im in enumerate(views):
        v=im.resize((round(im.width*ratio),round(im.height*ratio)),Image.Resampling.LANCZOS)
        canvas.paste(v,(119+212*i+(200-v.width)//2,y+10+(156-v.height)//2),v)
canvas.save(root/'part-atlases.jpg',quality=93)
