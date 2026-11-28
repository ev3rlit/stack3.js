"""Fit overlapping rounded solids to the independent part masks before organic extraction."""
import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt
from scipy.optimize import least_squares

ROOT=Path(__file__).parent.resolve()
# Normalized component coordinates: center, three radii, dx/dz and dy/dz.
templates={
    "crest": [
        ([-.20,.12,.35,.25,.36,.40,-.30,.53],2,0),
        ([ .16,-.08,.48,.27,.44,.52,.15,.53],2,0)],
    "leg": [
        ([0,-.24,.56,.19,.20,.50,0,0],6,0),
        ([0,-.19,.21,.34,.31,.22,0,0],3,0),
        ([0,.18,.18,.18,.33,.22,0,0],3,0),
        ([-.29,.08,.18,.17,.32,.22,0,0],3,.36),
        ([ .29,.08,.18,.17,.32,.22,0,0],3,-.36)]
}

def blend(a,b,k):
    return np.minimum(a,b)-np.maximum(k-abs(a-b),0)**2/(4*k)

def model(parameters,template,view,u,v,z3=None):
    fields=[]
    for values,(_,power,angle) in zip(parameters.reshape(-1,8),template):
        x,y,z,a,b,c,sx,sy=values
        co,si=np.cos(angle),np.sin(angle)
        if view in ('front','rear','left'):
            horizontal={'front':u,'rear':-u,'left':-u}[view]
            a2,center,slope=(np.hypot(a*si,b*co),y,sy) if view=='left' else (np.hypot(a*co,b*si),x,sx)
            f=((horizontal-center-slope*(v-z))/a2)**2+abs((v-z)/c)**power-1
            fields.append(f*.5*min(a2,c))
        elif view=='top':
            levels=np.linspace(-.96,.96,13)[:,None] if abs(sx)+abs(sy)>1e-10 else np.zeros((1,1))
            dx=u-x-sx*c*levels;dy=v-y-sy*c*levels
            f=((dx*co+dy*si)/a)**2+((-dx*si+dy*co)/b)**2+abs(levels)**power-1
            fields.append(f.min(axis=0)*min(a,b)*.5)
        else:
            dx=u-x-sx*(z3-z);dy=v-y-sy*(z3-z)
            f=((dx*co+dy*si)/a)**2+((-dx*si+dy*co)/b)**2+abs((z3-z)/c)**power-1
            fields.append(f*.5*min(a,b,c))
    result=fields[0]
    for f in fields[1:]:result=blend(result,f,.035)
    if view!='top':result=-blend(-result,z3 if view=='space' else v,.018)
    return result

def fit(part):
    folder=ROOT/part
    template=templates[part]
    initial=np.array([row[0] for row in template]).ravel()
    observations=[]
    size,pad=72,8
    for name in ['front','rear','left','top']:
        alpha=Image.open(folder/(name+'.png')).convert('RGBA').getchannel('A')
        mask=np.pad(np.asarray(alpha.resize((size,size),Image.Resampling.BOX))>=128,pad)
        dist=(distance_transform_edt(~mask)-distance_transform_edt(mask))/size
        yy,xx=np.where(abs(dist)<.09)
        yy,xx=yy[::3],xx[::3]
        u=(xx-pad+.5)/size-.5
        v=(yy-pad+.5)/size-.5 if name=='top' else 1-(yy-pad+.5)/size
        observations.append((name,u,v,dist[yy,xx]-np.sign(dist[yy,xx])*.5/size))
    delta=np.tile([.12,.14,.11,.10,.14,.10,.19,.45 if part=="crest" else .15],len(template))
    if part=="crest":
        delta.reshape(-1,8)[:,[1,4,7]]=[.36,.28,.65]
    lo=(initial-delta).reshape(-1,8);lo[:,3:6]=np.maximum(lo[:,3:6],.08)
    def residual(p):
        chunks=[np.clip(model(p,template,n,u,v),-.12,.12)-d for n,u,v,d in observations]
        if part=="crest":
            # LEFT lobe boundaries include the visible internal occlusion edge;
            # union masks alone allow the short feather to disappear in profile.
            rim = [
                [[.188,.714],[.070,.66],[.003,.51],[.026,.37],[.15,.20],[.29,.08]],
                [[.517,1.0],[.390,.96],[.320,.84],[.307,.66],[.348,.51],
                 [.439,.32],[.595,.085],[.740,.03],[.969,.10],[.992,.33],[.920,.65],[.776,.85]],
            ]
            for j, contour in enumerate(rim):
                lobe=p.reshape(-1,8)[j]
                points=np.array(contour)
                chunks.append(5*model(lobe,[template[j]],'left',points[:,0]-.5,points[:,1]))
                x,y,z,_,_,c,sx,sy=lobe
                top_x=[.197,.709][j]-.5
                top_y=.5-[.188,.517][j]
                top_z=[.733,1.0][j]
                chunks.append(12*np.array([x+sx*c-top_x,y+sy*c-top_y,z+c-top_z]))
        return np.r_[np.concatenate(chunks),.35*(p-initial)/delta]
    solution=least_squares(residual,initial,bounds=(lo.ravel(),initial+delta),max_nfev=40,ftol=1e-4)
    if not np.isfinite(solution.x).all():raise ValueError('invalid fit')
    (folder/'fit.json').write_text(json.dumps(solution.x.reshape(-1,8).tolist(),indent=2)+'\n')
    n=64; extra=.15
    t=(np.arange(n+2)-.5)/n*(1+2*extra)-extra
    field=model(solution.x,template,'space',t[:,None,None]-.5,t[None,:,None]-.5,t[None,None,:])
    save_field(folder,field,extra)
    print(part,solution.nfev,solution.cost,flush=True)

def save_field(folder,field,extra):
    part=folder.name
    n=field.shape[0]-2
    m=json.loads((folder/'stack/stack.json').read_text())
    field=field.astype(np.float32);field[field==0]=1e-7
    inside=field[1:-1,1:-1,1:-1]<0
    dest=folder/'fitted';dest.mkdir(exist_ok=True)
    np.save(dest/'field.npy',field)
    rgba=np.zeros((n,n,n,4),np.uint8);rgba[...,:3]=[239,150,53] if part in ('beak','leg') else [255,215,90]
    rgba[...,3]=inside*255
    pixels=rgba.transpose(2,1,0,3).reshape(-1,16,n,n,4).transpose(0,2,1,3,4).reshape(-1,16*n,4)
    Image.fromarray(pixels).save(dest/'stack.png')
    physical=np.array(m['size'])*(1+2*extra)
    m.update(width=n,depth=n,layers=n,columns=16,size=physical.tolist(),spacing=physical[2]/n,pivot=[0,0,extra])
    (dest/'stack.json').write_text(json.dumps(m,indent=2)+'\n')
    guide=dict(extractor='marching-cubes',sigma=0,interpolation='cubic',smoothingIterations=2,field='fitted/field.npy')
    (folder/'fitted.json').write_text(json.dumps(guide,indent=2)+'\n')
    recipe=(folder/'mesh.yaml').read_text().replace('path: ./stack','path: ./fitted').replace('./surface.json','./fitted.json').replace('./part.glb','./fitted.glb')
    (folder/'fitted.yaml').write_text(recipe)

if __name__=='__main__':
    for part in templates:fit(part)
