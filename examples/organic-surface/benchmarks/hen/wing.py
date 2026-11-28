"""Inflate the side contour and infer shallow feather grooves from the isolated side drawing."""
import numpy as np
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve
from scipy.ndimage import gaussian_filter, distance_transform_edt, map_coordinates

def field(images,t):
    n=156
    side=np.array(Image.fromarray(images['left']).resize((n,n),Image.Resampling.LANCZOS))
    mask=side[...,3]>=128
    rows,cols=np.where(mask);ids=np.full(mask.shape,-1,int);ids[mask]=np.arange(len(rows))
    i=[ids[mask]];j=[ids[mask]];values=[np.full(len(rows),4.)]
    for dy,dx in [(1,0),(-1,0),(0,1),(0,-1)]:
        yy=rows+dy;xx=cols+dx;valid=(xx>=0)&(xx<n)&(yy>=0)&(yy<n)
        v=valid.copy();v[valid]&=mask[yy[valid],xx[valid]]
        i.append(ids[rows[v],cols[v]]);j.append(ids[yy[v],xx[v]]);values.append(-np.ones(v.sum()))
    system=coo_matrix((np.concatenate(values),(np.concatenate(i),np.concatenate(j))),shape=(len(rows),len(rows))).tocsr()
    potential=np.zeros((n,n));potential[mask]=spsolve(system,np.ones(len(rows)))
    potential/=potential.max()
    outer=distance_transform_edt(~mask)
    potential[~mask]=-.06*outer[~mask]
    # A tonal crease interpreted as modest relief; the hidden inner face is inferred.
    nearest=distance_transform_edt(~mask,return_distances=False,return_indices=True)
    lum=side[...,0].astype(float)*.25+side[...,1]*.5+side[...,2]*.25
    lum=lum[tuple(nearest)]
    crease=np.clip((gaussian_filter(lum,7)-gaussian_filter(lum,1.2))/25,0,1)
    y,z=np.meshgrid(t,t,indexing='ij')
    coords=[(1-z)*n-.5,(1-y)*n-.5]
    u=map_coordinates(potential,coords,order=1,mode='nearest')
    # Extend the signed field beyond the fitted panel when a silhouette touches its box.
    outside=np.maximum.reduce([np.zeros_like(y),-y,y-1,-z,z-1])
    u-=outside*n*.06
    groove=map_coordinates(crease,coords,order=1,mode='nearest')
    depth=t[:,None,None]-.5
    radius=np.where(depth>=0,.53*(1-.17*groove),.47)
    return (depth/radius)**2-u[None,:,:]
