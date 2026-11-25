"""Bake a softly blended orthographic projection to a unique UV layout."""
import numpy as np
from PIL import Image
from scipy import ndimage as nd
import trimesh
import xatlas

def aircraft_projection(x,y,z,nx,ny,nz):
    # Blend in continuous position and normal space instead of at face boundaries.
    top=np.clip(1.7*nz+.40,0,1)
    # Use the plan-view canopy even on its lateral flanks to keep only one canopy.
    cockpit=np.clip((y-.46)*13,0,1)*np.clip((.90-y)*20,0,1)*np.clip((z-.32)*12,0,1)
    top=np.maximum(top,cockpit)
    # Side projection colors the tall tail planes; their plan appearance is edge-on.
    top*=1-np.clip((z-.65)*9,0,1)
    tail=np.clip((.073-y)*21,0,1)*np.clip(-ny*1.4,0,1)
    end=np.clip((ny-.75)*3,0,1)*(1-top)*(1-cockpit)
    t=np.clip((z*175-70)/85,0,1)
    fin=(abs(abs(x*457-225.9)-(49+42*t))<10)&(y*583<160)&(z*175>92)
    chord=np.clip((y*583-(32-31*t))/(124-89*t),0,1)
    left_u=np.where(fin,(538-chord*(89-54*t))/583,1-y)
    left_v=np.where(fin,(74-66*t)/175,1-z)
    top=np.where(fin,0,top)
    end=np.where(fin,0,end)
    tail=np.where(fin,0,tail)
    weights=((1-tail)*top,(1-tail)*(1-top)*(1-end),(1-tail)*(1-top)*end,tail)
    return ((x,y),(left_u,left_v),(x,1-z),(1-x,1-z)),weights

def bake(mesh, images, size, offset, rotate, projection=aircraft_projection, resolution=1152):
    v = np.ascontiguousarray(mesh.vertices,dtype='float32')
    f = np.ascontiguousarray(mesh.faces,dtype='uint32')
    layout=xatlas.Atlas()
    layout.add_mesh(v,f)
    pack=xatlas.PackOptions()
    pack.resolution=resolution
    pack.padding=4
    layout.generate(pack_options=pack)
    mapping,faces,uv = layout[0]
    width,height=layout.width,layout.height
    pixels=uv*np.array([width,-height])+np.array([0,height])-.5
    color=np.zeros((height,width,3),'uint8')
    covered=np.zeros((height,width),bool)
    normals=mesh.vertex_normals[mapping]
    unit=(mesh.vertices[mapping]-offset)/size
    for tri in faces:
        a,b,c=pixels[tri]
        lo=np.maximum(0,np.ceil(np.minimum(np.minimum(a,b),c)).astype(int))
        hi=np.minimum([width-1,height-1],np.floor(np.maximum(np.maximum(a,b),c)).astype(int))
        xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1),np.arange(lo[1],hi[1]+1))
        u,v=b-a,c-a
        det=u[0]*v[1]-u[1]*v[0]
        if abs(det)<1e-12: continue
        db=((xx-a[0])*v[1]-(yy-a[1])*v[0])/det
        dc=(u[0]*(yy-a[1])-u[1]*(xx-a[0]))/det
        valid=(db>=0)&(dc>=0)&(db+dc<=1)
        if not np.any(valid): continue
        bary=np.stack((1-db[valid]-dc[valid],db[valid],dc[valid]),axis=1)
        x,y,z=(bary@unit[tri]).T
        nx,ny,nz=(bary@normals[tri]).T
        projections,weights=projection(x,y,z,nx,ny,nz)
        rgb=np.zeros((len(x),3))
        for tex,(s,t),weight in zip(images,projections,weights):
            h,w=tex.shape[:2]
            xf=np.clip(s*w-.5,0,w-1); yf=np.clip(t*h-.5,0,h-1)
            x0=xf.astype(int);y0=yf.astype(int);x1=np.minimum(x0+1,w-1);y1=np.minimum(y0+1,h-1)
            fx=(xf-x0)[:,None];fy=(yf-y0)[:,None]
            rgb+=weight[:,None]*((1-fy)*((1-fx)*tex[y0,x0]+fx*tex[y0,x1])+fy*((1-fx)*tex[y1,x0]+fx*tex[y1,x1]))
        color[yy[valid],xx[valid]]=np.rint(rgb).clip(0,255)
        covered[yy[valid],xx[valid]]=True
    nearest=nd.distance_transform_edt(~covered,return_distances=False,return_indices=True)
    texture=Image.fromarray(color[tuple(nearest)])
    mat=trimesh.visual.material.PBRMaterial(name='Baked orthographic color',baseColorTexture=texture,
        baseColorFactor=[255,255,255,255],metallicFactor=.22,roughnessFactor=.48)
    return trimesh.Trimesh(vertices=mesh.vertices[mapping]@rotate, faces=faces,vertex_normals=normals@rotate,
        visual=trimesh.visual.texture.TextureVisuals(uv=uv,material=mat),process=False)
