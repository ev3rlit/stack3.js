"""Reconstruct smooth rings from the isolated body and wing profiles."""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import gaussian_filter1d
from fit_lobes import save_field

root=Path(__file__).resolve().parent
def span(mask,row):
    inds=np.flatnonzero(mask[row])
    return (inds[0]/mask.shape[1],(inds[-1]+1)/mask.shape[1])

def loft(part):
    folder=root/part
    masks={k:np.asarray(Image.open(folder/(k+'.png')).convert('RGBA'))[...,3]>=128 for k in ('left','front','top')}
    if part=='body':
        m1=masks['front'][::-1,:]
        m2=masks['left'][::-1,::-1]
    else:
        # Cross sections perpendicular to length (+Y points down on TOP and left on LEFT).
        m1=masks['top']
        m2=masks['left'][::-1,::-1].T
    stations=(np.arange(64)+.5)/64
    n=80;extra=.125
    axis=(np.arange(n+2)-.5)/n*(1+2*extra)-extra
    dims=[]
    for mask in [m1,m2]:
        borders=np.array([span(mask,min(len(mask)-1,int(q*len(mask)))) for q in stations])
        center=gaussian_filter1d(borders.mean(axis=1),1.0,mode='nearest')
        rr=gaussian_filter1d(((borders[:,1]-borders[:,0])/2)**2,.85,mode='nearest')
        at=np.clip(axis,0,1)
        centers=PchipInterpolator(np.r_[0,stations,1],np.r_[center[0],center,center[-1]])(at)
        radii=np.sqrt(np.maximum(1e-9,PchipInterpolator(np.r_[0,stations,1],np.r_[0,rr,0])(at)))
        dims.append((centers,radii))
    x,y,q=np.meshgrid(axis,axis,axis,indexing='ij',sparse=True)
    (cx,rx),(cy,ry)=dims
    dx=x-cx;dy=y-cy
    norm=np.sqrt((dx/rx)**2+(dy/ry)**2)
    field=np.where((q>0)&(q<1),(norm-1)*np.minimum(rx,ry),np.sqrt(dx*dx+dy*dy+(q-np.clip(q,0,1))**2))
    # Wing field above is in (X,Z,Y); stack export needs (X,Y,Z).
    save_field(folder,field if part=='body' else field.transpose(0,2,1),extra)

for part in ('body','wing'):
    loft(part)
