"""Register the four transparent plates and carve saved stacks with the installed CLI."""
import json,subprocess,sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import label

root=Path(__file__).resolve().parent
for part in (sys.argv[1:] or ('whole','body','comb','wing','wattle','beak','foot')):
    folder=root/part
    image=np.array(Image.open(folder/'atlas.png').convert('RGBA'))
    views={}
    for direction,panel in zip(('top','left','front','rear'),np.array_split(image,4,axis=1)):
        alpha=panel[...,3]>=128
        if part=='wattle':
            rgb=panel[...,:3].astype(int)
            alpha &= (rgb[...,0]-rgb[...,1]>44)
        components,_=label(alpha)
        best=np.bincount(components.ravel())[1:].argmax()+1
        keep=components==best
        y,x=np.where(keep)
        pixels=panel.copy();pixels[...,3]=keep*255
        pixels=pixels[y.min():y.max()+1,x.min():x.max()+1]
        Image.fromarray(np.pad(pixels,((1,1),(1,1),(0,0)))).save(folder/(direction+'.png'))
        views[direction]=direction+'.png'
    (folder/'views.json').write_text(json.dumps({'views':views},indent=2)+'\n')
    if part!='whole':
        subprocess.run(['stack3','build','views.json','--format','stack','--profile','round' if part=='body' else 'silhouette',
            '--height','1','--resolution','48','--layers','64','--output','stack'],cwd=folder,check=True)
