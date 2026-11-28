"""Compose review sheets and a synchronized turntable from the actual Blender renders."""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
renders = Path(sys.argv[1])
bg = "#f5f5f2"
ink = "#26342f"
muted = "#5b6560"
font_root = Path("/System/Library/Fonts")
font = str(font_root/"AppleSDGothicNeo.ttc") if (font_root/"AppleSDGothicNeo.ttc").exists() else "NotoSansCJK-Regular.ttc"
qa = json.loads((ROOT/"mesh-checks.json").read_text())


def label(page, xy, text, size=23, muted_text=False):
    ImageDraw.Draw(page).text(xy, text, font=ImageFont.truetype(font, size),
                              fill=muted if muted_text else ink)


def pose(page, case, view, xy, dims):
    img = Image.open(renders/case/(view+".png")).convert("RGBA").resize(dims,Image.Resampling.LANCZOS)
    page.paste(img,xy,img)


def stages():
    page = Image.new("RGB",(1440,1104),bg)
    label(page,(37,16),"원본 4뷰 아틀라스",34)
    atlas = Image.open(ROOT.parent/"chick-4view.png").convert("RGB")
    atlas.thumbnail((1190,272),Image.Resampling.LANCZOS)
    page.paste(atlas,((1440-atlas.width)//2,65))
    ImageDraw.Draw(page).line((36,355,1404,355),fill="#bcc6c1")
    for i,(case,title,sub) in enumerate([
        ("voxel","스태킹 직후 복셀","32 × 31 × 64  ·  round"),
        ("L","윤곽 로프트 · QEM 전","Marching Cubes  ·  16,288 triangles"),
        ("L-lod","윤곽 로프트 · QEM 후","동일 메시 감축  ·  1,600 triangles"),
    ]):
        left=480*i
        label(page,(left+36,376),title,32)
        label(page,(left+37,424),sub,21,True)
        pose(page,case,"clay-35",(left+29,456),(420,403))
        pose(page,case,"wire",(left+118,856),(244,234))
    page.save(ROOT/"stages.jpg",quality=94)


def ablations():
    entries=[("B","Hermite DC · QEM 전"),("A","Hermite DC · QEM 후"),("R","Regularized DC"),("C","Marching Cubes"),
             ("D","Surface Nets"),("E64","SDF 64³"),("E128","SDF 128³"),("F","폭 기반 타원"),
             ("G","폭 기반 B-spline"),("H","균일 리메싱"),("Hproj","리메싱 + 재투영"),("L","각도별 윤곽 로프트")]
    page=Image.new("RGB",(1440,1170),bg)
    for i,(case,title) in enumerate(entries):
        x,y=(i%4)*360,(i//4)*390
        label(page,(x+15,y+10),case+"   "+title,22)
        label(page,(x+16,y+47),f"{qa[case]['triangles']:,} triangles",17,True)
        pose(page,case,"clay-35",(x+1,y+70),(255,244))
        pose(page,case,"wire",(x+190,y+218),(165,158))
    page.save(ROOT/"ablations.jpg",quality=94)


def movie():
    cols=[("A","기존 Hermite DC"),("G-lod","폭 기반 타원 로프트"),("L-lod","각도별 윤곽 로프트")]
    template=Image.new("RGB",(1440,580),bg)
    for i,(case,title) in enumerate(cols):
        label(template,(480*i+24,14),title,29)
        label(template,(480*i+25,57),f"{qa[case]['triangles']:,} triangles",20,True)
    cmd=["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","rgb24","-s","1440x580","-r","24",
         "-i","-","-an","-c:v","libx264","-crf","17","-preset","fast","-pix_fmt","yuv420p","-movflags","+faststart",
         str(ROOT/"turntable.mp4")]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    for i in range(96):
        frame=template.copy()
        for col,(case,_) in enumerate(cols):
            pose(frame,case,f"turn-{i:03}",(480*col,90),(480,460))
        label(frame,(1340,539),f"{360*i/96:.0f}°",21,True)
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    if proc.wait():
        raise RuntimeError("Video encode failed")


stages()
ablations()
movie()
