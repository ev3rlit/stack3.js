"""Compose the matched, unretouched before/after renders."""
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont

before,after=map(Path,sys.argv[1:3])
out=Path(__file__).resolve().parent
font=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',28)
page=Image.new('RGB',(1248,946),'#f8f5f2')
draw=ImageDraw.Draw(page)
for column,folder in enumerate((before,after)):
    x=16+column*616
    for row,(part,label) in enumerate((('snout','콧구멍 입구'),('body','몸통과 네 다리'))):
        y=15+row*462
        draw.text((x+4,y),label+'  ·  '+('수정 전' if column==0 else '수정 후'),font=font,fill='#3d3437')
        im=Image.open(folder/(part+'.png')).convert('RGB').resize((600,403),Image.Resampling.LANCZOS)
        page.paste(im,(x,y+42))
page.save(out/(sys.argv[3] if len(sys.argv)>3 else 'comparison.jpg'),quality=95)
