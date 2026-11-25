"""Apply part-local sections to stack3's hulls, persist stacks, then mesh each PNG independently."""
from pathlib import Path
import json,sys
import numpy as np
from scipy import ndimage as nd
from PIL import Image
import trimesh
from vtkmodules.util.numpy_support import numpy_to_vtk,vtk_to_numpy
from vtkmodules.vtkCommonDataModel import vtkImageData
from vtkmodules.vtkFiltersCore import vtkFlyingEdges3D
here=Path(__file__).resolve().parent
sys.path.insert(0,str(here.parent/'scripts'))
from bake import bake
from common import save_json
work=Path(sys.argv[1]);specs=json.loads((here/'calibration.json').read_text())
rotate=np.array([[1,0,0],[0,0,-1],[0,1,0]])
def decode(path):
    m=json.loads((path/'stack.json').read_text())
    w,d,h,c=[m[k] for k in ('width','depth','layers','columns')]
    a=np.asarray(Image.open(path/'stack.png')).reshape(-1,d,c,w,4).transpose(0,2,1,3,4).reshape(-1,d,w,4)
    return m,a[:h].copy()
def encode(folder,m,t):
    folder.mkdir(parents=True,exist_ok=True)
    h,d,w=t.shape[:3];c=m['columns']
    padded=np.zeros(((h+c-1)//c*c,d,w,4),'uint8');padded[:h]=t
    a=padded.reshape(-1,c,d,w,4).transpose(0,2,1,3,4).reshape(-1,c*w,4)
    Image.fromarray(a).save(folder/'stack.png',optimize=True);save_json(folder/'stack.json',m)
def apply_sections(name,t):
    occ=t[...,3]>=128;h,d,w=occ.shape
    z,y,x=np.ogrid[:h,:d,:w]
    coverage=occ.astype('float32')
    if name in ('fuselage','nacelle','canopy'):
        # Every station gets its width and height from this atlas's sampled silhouettes.
        across=occ.any(axis=0);vertical=occ.any(axis=2).T
        x0=across.argmax(axis=1);x1=w-1-across[:,::-1].argmax(axis=1)
        z0=vertical.argmax(axis=1);z1=h-1-vertical[:,::-1].argmax(axis=1)
        rx=(x1-x0+1)[None,:,None]/2;rz=(z1-z0+1)[None,:,None]/2
        u=(x-(x0+x1)[None,:,None]/2)/np.maximum(rx,.5)
        q=(z-(z0+z1)[None,:,None]/2)/np.maximum(rz,.5)
        if name=='canopy':
            q=np.maximum(0,(z-z0[None,:,None]-.08*(2*rz))/(1.84*np.maximum(rz,.5)))
        exponent=2.45 if name=='fuselage' else 2
        radius=(abs(u)**exponent+abs(q)**exponent)**(1/exponent)
        strength=np.clip(.5+(1-radius)*np.minimum(rx,rz),0,1)
        coverage*=np.where(np.minimum(rx,rz)<1.55,1,strength)
    if name in ('wing','fin','canard'):
        # Fit a continuous pair of skins to the observed thin sections of this part.
        # Only the measured footprint participates in smoothing; there is no thickening offset.
        axis=2 if name=='fin' else 0
        strips=np.moveaxis(occ,axis,0)
        support=strips.any(0)
        low=strips.argmax(0)-.5
        high=len(strips)-strips[::-1].argmax(0)-.5
        weight=np.maximum(1e-7,nd.gaussian_filter(support.astype(float),2.1))
        lower=nd.gaussian_filter(low*support,2.1)/weight
        upper=nd.gaussian_filter(high*support,2.1)/weight
        height=np.arange(len(strips))[:,None,None]
        cover=np.clip(.5+np.minimum(height-lower,upper-height),0,1)*support
        coverage=np.moveaxis(cover,0,axis)
        # Carry the closest input color into fractional boundary cells.
        extra=(coverage>0)&~occ
        if extra.any():
            nearest=nd.distance_transform_edt(~occ,return_distances=False,return_indices=True)
            t[extra,:3]=t[tuple(nearest)][extra,:3]
    if name=='nacelle':
        # Negative sections come from this pod's own TOP scoop and REAR circular dark area.
        u=(x+.5)/w;v=(y+.5)/d;level=(z+.5)/h
        bounds=[.492,.512,.538,.57,.625,.69,.735,.751]
        width=np.interp(v,bounds,[0,.085,.175,.223,.210,.153,.075,0],left=0,right=0)
        depth=np.interp(v,bounds,[0,.11,.23,.23,.155,.077,.023,0],left=0,right=0)
        roof=(h-1-(coverage[::-1]>=.5).argmax(0)+.5)/h
        wall=np.minimum((width-abs(u-.502))*w,(level-(roof-depth))*h)
        scoop=np.clip(.5+wall,0,1)*(width>0)
        radius=np.sqrt(((u-.50)/.273)**2+((level-.485)/.27)**2)
        cup=np.clip(.5+np.minimum((1-radius)*min(w,h)*.27,(.079-v)*d),0,1)
        coverage*=1-np.maximum(scoop,cup)
    t[...,3]=np.rint(255*coverage).astype('uint8')
    t[t[...,3]==0]=0
    return t
def surface(t,m,budget,name):
    size=np.array(m['size']);pitch=size/np.array(t.shape[:3][::-1]);origin=-size*np.array([.5,.5,0])
    v=np.pad(t[...,3].astype('float32')/255,1)
    field=nd.gaussian_filter(v,(.77,.65,.68))
    if name=='fuselage':
        # Preserve the sampled needle at the nose.
        blend=np.clip((np.arange(v.shape[1])/m['depth']-.88)*14,0,.90)[None,:,None]
        field=(field*(1-blend)+v*blend).astype('float32')
    grid=vtkImageData();grid.SetOrigin(*(origin-pitch*.5));grid.SetSpacing(*pitch);grid.SetDimensions(*field.shape[::-1])
    grid.GetPointData().SetScalars(numpy_to_vtk(field.ravel(),deep=True))
    e=vtkFlyingEdges3D();e.SetInputData(grid);e.SetValue(0,.40);e.Update();poly=e.GetOutput()
    mesh=trimesh.Trimesh(vtk_to_numpy(poly.GetPoints().GetData()),vtk_to_numpy(poly.GetPolys().GetConnectivityArray()).reshape(-1,3),process=True)
    components=mesh.split(only_watertight=False);main=max(components,key=lambda c:c.area)
    mesh=main.simplify_quadric_decimation(face_count=min(budget,len(main.faces)),aggression=5)
    mesh.update_faces(mesh.nondegenerate_faces()&mesh.unique_faces());mesh.remove_unreferenced_vertices()
    if mesh.volume<0:mesh.invert()
    # Use the continuous-field gradient for shading after decimation; avoid staircase normals.
    smooth=nd.gaussian_filter(v,(1.65,1.35,1.35))
    grad=np.gradient(smooth,*pitch[::-1])
    coord=((mesh.vertices-origin)/pitch+.5)[:,::-1].T
    normals=-np.stack([nd.map_coordinates(g,coord,order=1,mode='nearest') for g in grad[::-1]],axis=1)
    norms=np.linalg.norm(normals,axis=1)
    valid=norms>1e-6
    normals[valid]/=norms[valid,None]
    normals[~valid]=mesh.vertex_normals[~valid]
    mix=normals*.80+mesh.vertex_normals*.20
    mesh.vertex_normals=mix/np.maximum(np.linalg.norm(mix,axis=1,keepdims=True),1e-12)
    return mesh,origin,len(components)
def sampler(name):
    def project(x,y,z,nx,ny,nz):
        ax,ay,az=abs(nx),abs(ny),abs(nz)
        plan=az**2*(1.7 if name in ('wing','canard') else 1.25)
        side=ax**2*(2.6 if name=='fin' else 1.)
        front=np.maximum(0,ny)**2*(.04+.96*np.clip((y-.82)*12,0,1))
        rear=np.maximum(0,-ny)**2*(.04+.96*np.clip((.17-y)*12,0,1))
        if name=='nacelle':
            plan+=2.4*np.clip((z-.48)*6,0,1)*np.clip((y-.45)*18,0,1)*np.clip((.79-y)*18,0,1)
            rear+=(y<.087)*2.8
        if name=='canopy':
            plan+=.45*np.clip((z-.15)*3,0,1)
        total=np.maximum(1e-10,plan+side+front+rear)
        return ((x,y),(1-y,1-z),(x,1-z),(1-x,1-z)),[s/total for s in (plan,side,front,rear)]
    return project
selected=sys.argv[2:] or list(specs)
assert set(selected)<=set(specs)
stats_path=here/'build.json'
stats=json.loads(stats_path.read_text()) if stats_path.exists() else {}
for name in selected:
    spec=specs[name]
    raw,tiles=decode(work/'raw'/name);count=int((tiles[...,3]>=128).sum())
    tiles=apply_sections(name,tiles)
    encode(here/'stacks'/name,raw,tiles)
    meta,saved=decode(here/'stacks'/name);assert np.array_equal(saved,tiles)
    mesh,origin,n=surface(saved,meta,spec['budget'],name)
    rgb=[]
    atlas=np.asarray(Image.open(here/'atlases'/f'{name}.png'))
    for x,y,w,h in spec['views'].values():
        img=atlas[y:y+h,x:x+w]
        nearest=nd.distance_transform_edt(img[...,3]<128,return_distances=False,return_indices=True)
        rgb.append(img[tuple(nearest)][...,:3])
    asset=bake(mesh,rgb,np.array(meta['size']),origin,rotate,sampler(name),resolution=768)
    asset.visual.material.name=name
    asset.visual.material.metallicFactor=.05 if name=='canopy' else .22
    asset.visual.material.roughnessFactor=.18 if name=='canopy' else .48
    (here/'models'/f'{name}.glb').write_bytes(trimesh.Scene({name:asset}).export(file_type='glb'))
    stats[name]=dict(raw_cells=count,occupied=int((saved[...,3]>=128).sum()),grid=list(saved.shape[:3][::-1]),
        triangles=len(mesh.faces),components_before_cleanup=n,watertight=bool(mesh.is_watertight),volume=float(mesh.volume))
    print(name,stats[name],flush=True)
save_json(here/'build.json',stats)
