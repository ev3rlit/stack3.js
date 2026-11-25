"""Save native WebGL and CPU foregrounds, prior to the CPU viewer backdrop."""
import base64
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright

url,output=sys.argv[1:3]
out=Path(output);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=browser.new_page(viewport={'width':1280,'height':714})
    page.on('pageerror',lambda e:print(e,flush=True))
    page.goto(url)
    page.wait_for_function('typeof window.capturePair==="function"',timeout=90000)
    for key in ('off','on','z72','xy72','xyz72'):
        for view in (('photo',) if key in ('off','on') else ('photo','top')):
            for lit in (False,True):
                shots=page.evaluate('args=>window.capturePair(...args)',[key,view,lit])
                for renderer,uri in shots.items():
                    prefix=key if key in ('off','on') else f'{key}-{view}'
                    (out/f"{prefix}-{renderer}-{'on' if lit else 'off'}.png").write_bytes(base64.b64decode(uri.split(',')[1]))
        print('Captured',key,flush=True)
    browser.close()
