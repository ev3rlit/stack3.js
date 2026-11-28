from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont

base=Path(sys.argv[1])
out=Image.new("RGB",(1360,570),"#f5f5f2")
d=ImageDraw.Draw(out)
font="/System/Library/Fonts/AppleSDGothicNeo.ttc"
d.text((24,14),"Triple-Dexel 깊이 검증 · 합성 기준물",font=ImageFont.truetype(font,32),fill="#26342f")
for i,(name,title) in enumerate([("L-lod","색상 아틀라스에서 복원"),("synthetic-reference","깊이를 추가한 합성 기준물"),("fused","같은 아틀라스 + 측정 깊이")]):
    x=i*450
    d.text((x+25,72),title,font=ImageFont.truetype(font,25),fill="#36443f")
    im=Image.open(base/name/"clay-35.png").convert("RGBA").resize((440,422),Image.Resampling.LANCZOS)
    out.paste(im,(x+5,106),im)
d.text((24,531),"세 모델의 재질·카메라·조명 동일   /   가운데 모델에만 검증용 굴곡을 설계하고 깊이를 캡처",font=ImageFont.truetype(font,20),fill="#52605a")
out.save(Path(__file__).resolve().parent/"depth-comparison.jpg",quality=94)
