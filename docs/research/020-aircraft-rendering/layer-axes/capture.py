"""Read the actual WebGL color buffer for matched cameras, materials and resolution."""
import base64
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

here=Path(__file__).resolve().parent
url,destination=sys.argv[1:3]
out=Path(destination);out.mkdir(parents=True,exist_ok=True)
setup=json.loads((here/'experiment.json').read_text())
cases=list(setup['cases'])
texel_cases=list(setup['matched_texels'])
views=['photo','front','side','top',*[f'{a}_{e}' for e in (15,55) for a in range(0,360,45)]]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=browser.new_page(viewport={'width':1280,'height':714})
    page.on('pageerror',lambda error:print('PAGE ERROR',error,flush=True))
    page.goto(url)
    page.wait_for_function('typeof window.axisCapture==="function"',timeout=90000)
    jobs=[('voxel','voxel'),*[(m,c) for c in cases for m in ('stack','mesh')],*[('stack',c) for c in texel_cases]]
    if '--matched-only' in sys.argv: jobs=[('stack',c) for c in texel_cases]
    for mode,case in jobs:
        for view in views:
            data=page.evaluate('args=>window.axisCapture(...args)',[case,mode,view])
            (out/f'{case}-{mode}-{view}.png').write_bytes(base64.b64decode(data.split(',')[1]))
        print(mode,case,len(views),'captures',flush=True)
    browser.close()
