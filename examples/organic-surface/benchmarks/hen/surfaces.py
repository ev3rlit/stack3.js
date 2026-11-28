"""Recover smooth part fields from registered masks and extract with the global organic backend."""
import json,subprocess,sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import distance_transform_edt,gaussian_filter1d
from scipy.optimize import least_squares

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'chick/parts'))
from fit_lobes import model, blend, templates
from wing import field as wing_field
from wattle_surface import field as wattle_field

# Each lobe has a center, radii, two slopes along height, vertical power and yaw.
shapes={
 'comb': [([0,.215,.49,.49,.27,.51,0,-.04],2,0),
          ([0,-.10,.37,.38,.24,.37,0,.05],2,0),
          ([0,-.315,.24,.28,.18,.25,0,.08],2,0)],
 'foot':templates['leg'],

}
budgets={'body':388,'wing':136,'comb':236,'wattle':124,'beak':124,'foot':164}
colors={'body':[247,238,217],'wing':[244,233,211],'comb':[235,75,52],'wattle':[225,66,44],
        'beak':[249,179,48],'foot':[246,156,47]}
def load_images(folder):
    return {v:np.array(Image.open(folder/(v+'.png')).convert('RGBA'))[1:-1,1:-1] for v in ('front','left','rear','top')}

def fitted_lobes(part,images,x,y,z):
    template=shapes[part]
    initial=np.asarray([r[0] for r in template]).ravel()
    bands=[]
    for view,img in images.items():
        alpha=Image.fromarray(img[...,3]).resize((68,68),Image.Resampling.BOX)
        mask=np.pad(np.array(alpha)>127,7)
        dist=(distance_transform_edt(~mask)-distance_transform_edt(mask))/68
        iy,ix=np.where(abs(dist)<.075);iy,ix=iy[::4],ix[::4]
        u=(ix-7+.5)/68-.5
        v=(iy-7+.5)/68-.5 if view=='top' else 1-(iy-7+.5)/68
        bands.append((view,u,v,dist[iy,ix]-np.sign(dist[iy,ix])*.5/68))
    delta=np.tile([.075,.075,.065,.065,.07,.065,.12,.15],len(template))
    low=initial-delta;low.reshape(-1,8)[:,3:6]=np.maximum(low.reshape(-1,8)[:,3:6],.07)
    def sample(p,view,u,v,z3=None):
        # The shared fitter includes a plantar cap. Only feet need that plane.
        if part!='foot' and view!='top':
            params=p.reshape(-1,8).copy();params[:,2]+=2
            if view=='space':return model(params,template,view,u,v,z3+2)
            return model(params,template,view,u,v+2)
        return model(p,template,view,u,v,z3)
    def residual(p):
        values=[np.clip(sample(p,k,u,v),-.10,.10)-ds for k,u,v,ds in bands]
        # Keep the three comb peaks and overlapping wattle bulbs ordered when a projection occludes them.
        return np.r_[np.concatenate(values),.38*(p-initial)/delta]
    sol=least_squares(residual,initial,bounds=(low,initial+delta),max_nfev=28,ftol=.0002)
    (ROOT/part/'fit.json').write_text(json.dumps(sol.x.reshape(-1,8).tolist(),indent=2)+'\n')
    if part=='comb':
        # Retain distinct shoulders near the two occluded rear lobes. Use the
        # three observed LEFT lobe centers; the outer mask alone underconstrains them.
        fitted=sol.x.reshape(-1,8).copy()
        fitted[:,1]=[.211,-.145,-.363]
        fitted[:,4]*=[.96,.82,.80]
        fitted[:,7]=[-.02,-.028,-.032]
        fitted[:,2]+=[.025,.012,.005]
        (ROOT/part/'fit.json').write_text(json.dumps(fitted.tolist(),indent=2)+'\n')
        return sample(fitted.ravel(),'space',x-.5,y-.5,z)
    return sample(sol.x,'space',x-.5,y-.5,z)

def span(row):
    idx=np.flatnonzero(row)
    return idx[0]/len(row),(idx[-1]+1)/len(row)

def body_field(images,t):
    st=(np.arange(64)+.5)/64
    bounds=[]
    for mask in [images['front'][::-1,:,3]>127,images['left'][::-1,::-1,3]>127]:
        limits=np.asarray([span(mask[int(h*len(mask))]) for h in st])
        center=gaussian_filter1d(limits.mean(1),1.6)
        r2=gaussian_filter1d((np.diff(limits,axis=1)[:,0]/2)**2,1.15)
        q=np.clip(t,0,1)
        bounds.append((np.interp(q,st,center),np.sqrt(np.maximum(1e-10,
            PchipInterpolator(np.r_[0,st,1],np.r_[0,r2,0])(q)))))
    (cx,rx),(cy,ry)=bounds
    dx=t[:,None,None]-cx;dy=t[None,:,None]-cy
    field=(np.sqrt((dx/rx)**2+(dy/ry)**2)-1)*np.minimum(rx,ry)
    return np.where((t>0)&(t<1),field,np.sqrt(dx**2+dy**2+(t-np.clip(t,0,1))**2))

def bill_field(images,t):
    top=images['top'][...,3]>127;side=images['left'][...,3]>127
    st=(np.arange(64)+.5)/64;rows=[]
    for q in st:
        lo,hi=span(top[int(q*len(top))])
        col=side[::-1,min(side.shape[1]-1,int((1-q)*side.shape[1]))]
        diff=np.diff(np.r_[False,col,False].astype(int))
        a,b=np.where(diff==1)[0]/len(col),np.where(diff==-1)[0]/len(col)
        mouth=np.clip(.412,a[0]+.23*(b[-1]-a[0]),b[-1]-.23*(b[-1]-a[0]))
        gap=0
        if len(a)>1:mouth=(b[0]+a[-1])/2;gap=a[-1]-b[0]
        rows.append([(lo+hi)/2,(hi-lo)/2,a[0],b[-1],mouth,gap])
    pars=gaussian_filter1d(np.array(rows),.7,axis=0,mode='nearest')
    cx,rx,l,h,m,g=PchipInterpolator(st,pars)(np.clip(t,st[0],st[-1])).T
    def oval(lo,hi,r):
        rz=np.maximum((hi-lo)/2,1e-4)
        dx=(t[:,None,None]-cx[None,:,None])/r[None,:,None]
        dz=(t[None,None,:]-(hi+lo)[None,:,None]/2)/rz[None,:,None]
        return (np.hypot(dx,dz)-1)*np.minimum(r,rz)[None,:,None]
    jaws=blend(oval(m+g/2,h,rx),oval(l,m-g/2,.93*rx),.008)
    w=np.clip((t-.20)/.50,0,1);w=(w*w*(3-2*w))[None,:,None]
    return -blend(-(w*jaws+(1-w)*oval(l,h,rx)),np.minimum(t,1-t)[None,:,None],.018)

def build(part):
    folder=ROOT/part;images=load_images(folder)
    n=64;extra=.14;t=(np.arange(n+2)-.5)/n*(1+2*extra)-extra
    x,y,z=t[:,None,None],t[None,:,None],t[None,None,:]
    if part=='body':field=body_field(images,t)
    elif part=='beak':field=bill_field(images,t)
    elif part=='wing':field=wing_field(images,t)
    elif part=='wattle':field=wattle_field(images,t)
    else:field=fitted_lobes(part,images,x,y,z)
    field=field.astype('f4');field[field==0]=1e-7
    inside=field[1:-1,1:-1,1:-1]<0
    dest=folder/'fitted';dest.mkdir(exist_ok=True)
    np.save(dest/'field.npy',field)
    # The low-frequency pigment comes from the registered views; studio lighting supplies the main shading.
    sample=t[1:-1];X,Y,Z=np.meshgrid(sample,sample,sample,indexing='ij')
    grad=np.gradient(field[1:-1,1:-1,1:-1])
    nx,ny,nz=grad
    weights={'left':abs(nx)**2,'front':np.maximum(ny,0)**2,'rear':np.minimum(ny,0)**2,'top':abs(nz)**2}
    uv={'front':(X,1-Z),'rear':(1-X,1-Z),'left':(1-Y,1-Z),'top':(X,Y)}
    mix=np.zeros((*inside.shape,3));denom=np.maximum(sum(weights.values()),1e-14)
    for name,img in images.items():
        valid=img[...,3]>127
        near=distance_transform_edt(~valid,return_indices=True,return_distances=False)
        rgb=img[...,:3][tuple(near)].astype(float);u,v=uv[name];h,w=valid.shape
        sampled=rgb[np.clip((v*h).astype(int),0,h-1),np.clip((u*w).astype(int),0,w-1)]
        mix+=(weights[name]/denom)[...,None]*(sampled-np.median(rgb[valid],axis=0))
    rgba=np.zeros((*inside.shape,4),np.uint8);rgba[...,:3]=np.clip(colors[part]+.22*mix,0,255);rgba[...,3]=inside*255
    tiles=rgba.transpose(2,1,0,3).reshape(-1,16,n,n,4).transpose(0,2,1,3,4).reshape(-1,16*n,4)
    Image.fromarray(tiles).save(dest/'stack.png')
    m=json.loads((folder/'stack/stack.json').read_text());size=np.array(m['size'])*(1+2*extra)
    m.update(width=n,depth=n,layers=n,columns=16,size=size.tolist(),spacing=size[2]/n,pivot=[0,0,extra])
    (dest/'stack.json').write_text(json.dumps(m,indent=2)+'\n')
    guide=dict(field='fitted/field.npy',sigma=0,extractor='marching-cubes',interpolation='cubic',smoothingIterations=2)
    (folder/'organic.json').write_text(json.dumps(guide,indent=2)+'\n')
    (folder/'mesh.yaml').write_text(f"""version: 1
nodes:
  - {{ id: input, type: load-stack, path: ./fitted }}
  - id: surface
    type: extract-mesh
    input: input
    method: organic
    guide: ./organic.json
    finish: {{ triangleBudget: {budgets[part]} }}
  - {{ id: export, type: write-glb, input: surface, path: ./part.glb, lit: true }}
""")
    subprocess.run(['stack3','pipeline','run','mesh.yaml'],cwd=folder,check=True)
    studio=(folder/'mesh.yaml').read_text().replace(f'triangleBudget: {budgets[part]}',f'triangleBudget: {4*budgets[part]}').replace('./part.glb','./studio.glb')
    (folder/'studio.yaml').write_text(studio)
    subprocess.run(['stack3','pipeline','run','studio.yaml'],cwd=folder,check=True)

if __name__=='__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(build,sys.argv[1:] or budgets))
