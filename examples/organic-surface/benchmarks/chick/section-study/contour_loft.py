"""Fit a periodic tensor-product cubic B-spline to outer contours of the registered torso."""
from pathlib import Path
import json
import numpy as np
from scipy.interpolate import make_lsq_spline
from scipy.ndimage import map_coordinates, spline_filter
from sections import read_stack, save_grid, smoothstep


def circular_basis(theta, controls):
    # Cardinal cubic B-spline basis with periodic angular boundary conditions.
    u = (theta[...,None] / (2*np.pi)*controls - np.arange(controls) + controls/2) % controls - controls/2
    a = abs(u)
    return np.where(a < 1, (4-6*a*a+3*a**3)/6, np.maximum(2-a,0)**3/6)


def main():
    meta, rgba = read_stack(Path("grid64"))
    size, pivot = np.array(meta["size"]), np.array(meta["pivot"])
    step = size/np.array(rgba.shape[:3])
    origin = -size*[.5,.5,0]-pivot
    field = np.load("grid64/field.npy")
    coeff = spline_filter(field, order=3, mode="mirror")
    theta = np.linspace(0,2*np.pi,96,endpoint=False)
    heights = (np.arange(8,60)+.5)/64
    lower = np.zeros((len(theta),len(heights)))
    upper = np.full(lower.shape,.62)

    def distance(rad):
        points = np.stack(np.broadcast_arrays(rad*np.cos(theta[:,None]),rad*np.sin(theta[:,None]),heights),axis=-1)
        return map_coordinates(coeff,((points-origin)/step+.5).transpose(2,0,1),order=3,mode="mirror",prefilter=False)
    if (distance(lower)>=0).any() or (distance(upper)<=0).any():
        raise ValueError("Center or exterior samples fail the radial loft assumptions")
    # Check the star-shaped assumption before choosing a single contour radius.
    samples = np.stack([distance(np.full(lower.shape,r)) < 0 for r in np.linspace(0,.62,96)])
    if (np.diff(samples.astype(int),axis=0)>0).any():
        raise ValueError("Multiple radial intervals in selected torso band")
    for _ in range(18):
        mid=(lower+upper)*.5
        inside=distance(mid)<0
        lower=np.where(inside,mid,lower)
        upper=np.where(inside,upper,mid)
    radii=(lower+upper)*.5
    controls=16
    ring_coeff=np.linalg.lstsq(circular_basis(theta,controls),radii,rcond=None)[0].T
    knots=np.r_[[heights[0]]*4,heights[5:-4:5],[heights[-1]]*4]
    spline=make_lsq_spline(heights,ring_coeff,knots,k=3)
    x,y,z=[o+(np.arange(n)-.5)*p for o,n,p in zip(origin,field.shape,step)]
    phi=np.arctan2(y[None,:],x[:,None])
    target=circular_basis(phi,controls) @ spline(np.clip(z,heights[0],heights[-1])).T
    loft=np.hypot(x[:,None],y[None,:])[...,None]-target
    weight=smoothstep((z-.17)/.10)*smoothstep((.90-z)/.10)
    save_grid("contour",field*(1-weight)+loft*weight,rgba[...,:3],size,pivot)


if __name__=="__main__":
    main()
