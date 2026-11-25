"""Run against the repository root served by Vite, using installed Chrome."""
import base64
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright

url,destination=sys.argv[1:3]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True,args=['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=browser.new_page(viewport={'width':1280,'height':714})
    page.on('pageerror',lambda err: print(err,flush=True))
    page.goto(url)
    page.wait_for_function('typeof window.capture==="function"')
    shots=page.evaluate('window.capture()')
    for name,uri in shots.items():
        (Path(destination)/('section-loft-'+name+'.png')).write_bytes(base64.b64decode(uri.split(',')[1]))
    print('Rendered',list(shots))
    browser.close()
