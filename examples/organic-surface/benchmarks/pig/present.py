"""Assemble the three evaluated ear poses and encode the studio loop."""
import json,subprocess,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

root=Path(__file__).resolve().parent;cache=Path(sys.argv[1])
points=json.loads((cache/'points.json').read_text())
font='/System/Library/Fonts/AppleSDGothicNeo.ttc'
sheet=Image.new('RGB',(1260,465),'#faf6f2');d=ImageDraw.Draw(sheet)
for i,(pose,title) in enumerate([('open','펼침'),('mid','중간'),('folded','접힘')]):
    tile=Image.open(cache/('bones-'+pose+'.png')).convert('RGBA')
    tile=tile.resize((420,402),Image.Resampling.LANCZOS)
    sheet.paste(tile,(420*i,20),tile)
    chain=[(420*i+x*420/460,20+y*402/440) for x,y in points[pose]]
    d.line(chain,fill='#74454e',width=3)
    for x,y in chain:d.ellipse((x-4,y-4,x+4,y+4),fill='#fff9ee',outline='#663b43',width=2)
    d.text((420*i+210,429),title,font=ImageFont.truetype(font,24),fill='#422f31',anchor='mm')
sheet.save(root/'ear-bones.jpg',quality=96)
subprocess.run(['ffmpeg','-v','error','-y','-framerate','24','-start_number','0','-i',str(cache/'%03d.png'),
                '-frames:v','84','-an','-c:v','libx264','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(root/'ear-fold.mp4')],check=True)
subprocess.run(['ffmpeg','-v','error','-y','-i',str(root/'ear-fold.mp4'),'-vf','fps=12,scale=500:-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=bayer:bayer_scale=4','-loop','0',str(root/'ear-fold.gif')],check=True)
