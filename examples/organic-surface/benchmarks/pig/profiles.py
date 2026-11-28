"""Build deformation rings from the straight ear and a closed snout with blind nostril recesses."""
from pathlib import Path
import json
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter1d
from scipy.interpolate import PchipInterpolator
from organic_surfaces import make_body, make_snout

root=Path(__file__).resolve().parent
meta=json.loads((root/'ear/stack/stack.json').read_text())
w,d,l,c=[meta[k] for k in ('width','depth','layers','columns')]
atlas=np.asarray(Image.open(root/'ear/stack/stack.png').convert('RGBA'))
mask=atlas.reshape(-1,d,c,w,4).transpose(0,2,1,3,4).reshape(-1,d,w,4)[:l,...,3]>=128
stations=[];bounds=[]
for i,layer in enumerate(mask):
    yy,xx=np.where(layer)
    if len(xx):
        stations.append((i+.5)/l)
        bounds.append([(xx.min()+xx.max()+1)/(2*w)-.5,(xx.max()-xx.min()+1)/(2*w),
                       (yy.min()+yy.max()+1)/(2*d)-.5,(yy.max()-yy.min()+1)/(2*d)])
bounds=gaussian_filter1d(np.array(bounds),1.25,axis=0,mode='nearest')
heights=np.array([.012,.032,.065,.11,.16,.205,.25,.295,.34,.39,.445,.50,.555,.615,.68,.75,.82,.88,.93,.968,.987])
spans=PchipInterpolator(stations,bounds)(np.clip(heights,stations[0],stations[-1]))
# Round the root and tip caps and preserve the flat, softly cupped blade.
coords=[[0,0,0]];faces=[]
N=14
for k,(z,(cx,rx,cy,ry)) in enumerate(zip(heights,spans)):
    cap=min(1,np.sqrt(z/.045),np.sqrt((1-z)/.035))
    for i in range(N):
        phi=2*np.pi*i/N
        x=np.cos(phi)*rx*cap
        y=cy*.33+ry*.47*np.sin(phi)*cap+.45*(np.cos(phi)**2-.42)*rx*cap
        coords.append([cx+x,y,z])
        a=1+k*N+i;b=1+k*N+(i+1)%N
        if k==0:faces.append([0,b,a])
        if k:faces.extend([[a-N,b-N,b],[a-N,b,a]])
coords.append([spans[-1,0],spans[-1,2]*.33,1])
for i in range(N):faces.append([1+(len(heights)-1)*N+i,1+(len(heights)-1)*N+(i+1)%N,len(coords)-1])
np.savez(root/'ear/rest.npz',v=coords,f=faces)

# Front of the snout is a rounded pad. The widths/locations of its two sockets come from the FRONT image.
im=np.asarray(Image.open(root/'snout/front.png').convert('RGBA'))
from scipy.ndimage import label,find_objects
dark=(im[...,0]<209)&(im[...,1]<126)&(im[...,3]>127)
yy,xx=np.indices(dark.shape)
dark &= (yy>dark.shape[0]*.22)&(yy<dark.shape[0]*.76)&(xx>dark.shape[1]*.14)&(xx<dark.shape[1]*.86)
labels,_=label(dark)
blobs=sorted([s for s in find_objects(labels) if s is not None],key=lambda s:(s[0].stop-s[0].start)*(s[1].stop-s[1].start),reverse=True)[:2]
assert len(blobs)==2
sockets=[]
for rows,cols in blobs:
    H,W=dark.shape
    sockets.append([(cols.start+cols.stop)/(2*W)-.5,.5-(rows.start+rows.stop)/(2*H),
                    (cols.stop-cols.start)/(2*W),(rows.stop-rows.start)/(2*H)])
np.savez(root/'snout/surface.npz',**make_snout(sockets))
np.savez(root/'snout/game-surface.npz',**make_snout(sockets,game=True))
(root/'snout/sockets.json').write_text(json.dumps(sockets,indent=2)+'\n')

# Smooth axial lofts keep the projected widths without quantized vertical walls.
for part,ring_count,segments in [('head',17,28),('torso',15,24),('leg',11,16)]:
    limits=[]
    stations=(np.arange(64)+.5)/64
    for name in ('front','left'):
        alpha=np.asarray(Image.open(root/part/(name+'.png')))[...,3]>=128
        if name=='left':alpha=alpha[:,::-1]
        values=[]
        for q in stations:
            ix=np.flatnonzero(alpha[min(alpha.shape[0]-1,int((1-q)*alpha.shape[0]))])
            values.append(((ix[0]+ix[-1]+1)/(2*alpha.shape[1])-.5,(ix[-1]-ix[0]+1)/(2*alpha.shape[1])))
        values=np.asarray(values)
        local_z=np.array([.012,.045,.13,.20,.223,.245,.42,.66,.84,.95,.986]) if part=='leg' else (1-np.cos(np.pi*(np.arange(ring_count)+.5)/ring_count))/2
        centers=gaussian_filter1d(values[:,0],2.0,mode='nearest')
        radii=gaussian_filter1d(values[:,1]**2,1.6,mode='nearest')
        limits.append((np.interp(local_z,stations,centers),
                       np.sqrt(PchipInterpolator(np.r_[0,stations,1],np.r_[0,radii,0])(local_z))))
    (cx,rx),(cy,ry)=limits
    v=[[cx[0],cy[0],-.5]];f=[]
    for k,q in enumerate(local_z):
        for j in range(segments):
            phi=2*np.pi*j/segments
            v.append([cx[k]+rx[k]*np.cos(phi),cy[k]+ry[k]*np.sin(phi),q-.5])
            a=1+k*segments+j;b=1+k*segments+(j+1)%segments
            if not k:f.append([0,b,a])
            if k:f.extend([[a-segments,b-segments,b],[a-segments,b,a]])
    v.append([cx[-1],cy[-1],.5])
    for j in range(segments):f.append([1+(len(local_z)-1)*segments+j,1+(len(local_z)-1)*segments+(j+1)%segments,len(v)-1])
    np.savez(root/part/'loft.npz',v=v,f=f)

np.savez_compressed(root/'torso/unified.npz',**make_body(root))

# A height-registered pigment map keeps a clean hoof border on the same skin surface.
u=(np.arange(128)+.5)/128
z=((511-np.arange(512)+.5)/512*.63-.015)[:,None]
line=.057+.002*np.cos(2*np.pi*u)
t=np.clip((z-line+.002)/.004,0,1)
t=(t*t*(3-2*t))[...,None]
rgb=np.array([83,57,55])*(1-t)+np.array([252,181,182])*t
Image.fromarray(np.uint8(np.rint(rgb))).save(root/'torso/skin-hoof.png')
