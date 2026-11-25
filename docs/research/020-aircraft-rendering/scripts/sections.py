"""Author a second horizontal RGBA stack from plan/elevation landmarks on this atlas.

All distances are image pixels in the registered input planes. Piecewise profiles
and the elliptical body cross sections are explicit shape assumptions.
"""
import json
import numpy as np
from scipy import ndimage as nd
from PIL import Image
from common import ROOT,read_stack

m,_=read_stack()
w,d,h,c=(m[k] for k in ('width','depth','layers','columns'))
iw,il,ih=json.loads((ROOT/'inputs/registration.json').read_text())['size_pixels']
plan=np.asarray(Image.open(ROOT/'inputs/top.png'))
def sample(ox,oy,oz):
    x=(np.arange(w)[None,None,:]+ox)*iw/w
    y=(np.arange(d)[None,:,None]+oy)*il/d
    z=(np.arange(h)[:,None,None]+oz)*ih/h
    dx=np.abs(x-225.9)
    inside=plan[(y[0,:,0]).astype(int)[:,None], (x[0,0]).astype(int)[None,:],3]>=128
    def profile(stations):
        pos,val=zip(*stations)
        return np.interp(y,pos,val)

    # Fuselage breadth and the crown/belly curves from TOP and LEFT, tail to nose.
    radius=profile([(0,1),(30,10),(65,20),(142,32),(226,44),(270,48),(310,46),(345,36),
                    (387,30),(437,22),(470,16),(497,10),(520,3.3),(550,1.5),(583,1.3)])
    upper=profile([(0,76),(36,94),(82,99),(220,102),(278,105),(305,107),(340,111),
                   (378,110),(405,104),(440,88),(471,77),(511,62),(540,60),(583,58)])
    lower=profile([(0,41),(60,35),(150,29),(265,32),(355,40),(430,45),(475,48),
                   (515,54),(540,57),(583,56)])
    def ellipse(offset_x,rx,zmid,rz):
        return (offset_x/np.maximum(.5,rx))**2+((z-zmid)/np.maximum(.5,rz))**2<=1
    body=ellipse(dx,radius,(upper+lower)/2,(upper-lower)/2)&(y>=28)
    # Paired cylinders end at the observed two exhaust discs, transitioning into the shoulders.
    engine_offset=profile([(0,27),(150,31),(280,29),(330,25)])
    engine_radius=profile([(0,15),(8,17),(40,20),(92,21),(149,22),(194,21),(270,15),(327,9),(345,1)])
    engine_z=profile([(0,60),(100,65),(150,68),(220,65),(345,61)])
    engine_rz=profile([(0,21),(10,23),(100,27),(155,25),(260,17),(340,2)])
    nacelles=ellipse(dx-engine_offset,engine_radius,engine_z,engine_rz)&(y<345)
    # Plan masks retain the source leading and trailing edges.
    wing_mid=56-7*np.clip((dx-40)/174,0,1)
    wing_half=2.1+6*(1-np.clip((dx-37)/188,0,1))
    wings=(y>57)&(y<272)&(dx>26)&(np.abs(z-wing_mid)<=wing_half)
    canards=(y>=272)&(y<351)&(dx>24)&(np.abs(z-(43+2*np.clip((dx-30)/60,0,1)))<=3.2)
    # Interpolate each tail section from its root to its visible tip in TOP and FRONT.
    t=(z-70)/85
    fin_mid=49+42*t
    fins=(t>=0)&(t<=1)&(np.abs(dx-fin_mid)<=5.1-3.2*t)&(y>=32-31*t)&(y<=156-120*t)
    t_tip=(z-47)/30
    winglets=(t_tip>=0)&(t_tip<=1)&(np.abs(dx-(215+9*t_tip))<3.1-1.4*t_tip)&(y>=66-26*t_tip)&(y<113-27*t_tip)
    return inside[None,...]&(body|nacelles|wings|canards|fins|winglets)
# Record subcell coverage directly in each stored slice's alpha channel.
samples=np.zeros((h,d,w),np.uint8)
for ox in (.25,.75):
    for oy in (.25,.75):
        for oz in (.125,.375,.625,.875):
            samples+=sample(ox,oy,oz)
coverage=np.rint(samples* (255/16)).astype('uint8')
# The pitot is narrower than one plan texel at stack resolution. Keep one
# intersected grid cell along its centerline, measured separately in TOP and LEFT.
side_alpha=np.asarray(Image.open(ROOT/'inputs/left.png'))[...,3]>=128
for row in range(round(d*502/il),d):
    y0=int(row*il/d)
    y1=max(y0+1,round((row+1)*il/d))
    xs=np.where(np.any(plan[y0:y1,:,3]>=128,axis=0))[0]
    zs=np.where(np.any(side_alpha[:,max(0,il-y1):il-y0],axis=1))[0]
    if xs.size and zs.size:
        ix=int((xs.mean()+.5)*w/iw)
        iz=int((ih-zs.mean()-.5)*h/ih)
        coverage[iz,row,ix]=255
occupied=coverage>=128
x=(np.arange(w)[None,None,:]+.5)*iw/w
y=(np.arange(d)[None,:,None]+.5)*il/d
z=(np.arange(h)[:,None,None]+.5)*ih/h
# Keep the component attached to the airframe after grid sampling fine linework.
labels,n=nd.label(occupied)
counts=np.bincount(labels.ravel()); counts[0]=0
occupied=(labels==counts.argmax())
# The stack has real RGBA tiles. Paint dorsal surfaces from TOP and tall fins from LEFT.
left=np.asarray(Image.open(ROOT/'inputs/left.png'))
def bleed(tile):
    nearest=nd.distance_transform_edt(tile[...,3]<128,return_distances=False,return_indices=True)
    return tile[tuple(nearest)][...,:3]
rgb_plan=bleed(plan)[y[0,:,0].astype(int)[:,None],x[0,0].astype(int)[None,:]]
rgb_side=bleed(left)[np.clip((ih-z[:,0,0]).astype(int),0,ih-1)[:,None],np.clip((il-y[0,:,0]).astype(int),0,il-1)[None,:]]
tiles=np.zeros((h,d,w,4),'uint8')
tiles[...,:3]=np.where((z>114)[...,None],rgb_side[:,:,None,:],rgb_plan[None,...])
keep=nd.binary_dilation(occupied,iterations=2)
tiles[...,3]=np.where(keep,coverage,0)
tiles[tiles[...,3]==0]=0
padded=np.zeros(((h+c-1)//c*c,d,w,4),'uint8');padded[:h]=tiles
atlas=padded.reshape(-1,c,d,w,4).transpose(0,2,1,3,4).reshape(-1,c*w,4)
dest=ROOT/'section-stack'; dest.mkdir(exist_ok=True)
(dest/'stack.json').write_text((ROOT/'stack/stack.json').read_text())
Image.fromarray(atlas).save(dest/'stack.png')
print('Section-guided stack',int(occupied.sum()),'cells')
