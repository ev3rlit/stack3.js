"""Continuous nostril bowls and one smooth-union field for the belly and four legs."""
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter
from scipy.interpolate import PchipInterpolator
from skimage.measure import marching_cubes
from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon


def smoothstep(q):
    q = np.clip(q, 0., 1.)
    return q*q*(3-2*q)


def smooth_union(a, b, width):
    t = np.maximum(width-np.abs(a-b), 0)
    return np.minimum(a, b) - t*t/(4*np.maximum(width, 1e-12))


def make_snout(sockets, game=False):
    # All bowl rings are retained, including on the independently tessellated LOD.
    sectors = 16 if game else 40
    shell_count = 20 if game else 64
    # The central bowl meets a short inner wall and a rounded lip. The small
    # positive roll outside the wall gives the opening a readable highlight.
    radii = [0,.28,.48,.60,.69,.75,.81,.89,1.,1.14,1.26,1.39,1.48]
    profile = [1,.986,.94,.85,.68,.46,.29,.155,.060,.003,-.015,-.005,0]
    depth_at = PchipInterpolator(radii, profile)
    ring_radii = [.48,.69,.81,1.,1.48] if game else radii[1:]
    vertices, faces, tint = [], [], []

    def vertex(x,y,z,darkening=0.):
        vertices.append([x,y,z]); tint.append(darkening)
        return len(vertices)-1

    def face_front(x,z):
        return .495 - .11*((x/.50)**2+(z/.50)**2)

    def bridge(a,b):
        for j in range(len(a)):
            k=(j+1)%len(a)
            faces.extend([[a[j],b[k],b[j]], [a[j],a[k],b[k]]])

    holes=[]
    for cx,cz,rx,rz in sockets:
        rx=np.clip(rx*1.23,.076,.10); rz=np.clip(rz*1.12,.135,.18)
        depth=.345
        center=vertex(cx,face_front(cx,cz)-depth,cz,1.)
        prev=None
        for r in ring_radii:
            depression=float(depth_at(r))
            ring=[]
            for a in np.arange(sectors)*2*np.pi/sectors:
                x=cx+rx*r*np.cos(a); z=cz+rz*r*np.sin(a)
                ring.append(vertex(x,face_front(x,z)-depth*depression,z,max(0.,depression)**1.4))
            if prev is None:
                faces.extend([[center,ring[(j+1)%sectors],ring[j]] for j in range(sectors)])
            else:
                bridge(prev,ring)
            prev=ring
        holes.append(prev)

    theta=np.arange(shell_count)*2*np.pi/shell_count
    ox=np.sign(np.cos(theta))*abs(np.cos(theta))**(2/2.3)
    oz=np.sign(np.sin(theta))*abs(np.sin(theta))**(2/2.3)
    front=[vertex(.446*x,face_front(.446*x,.446*z),.446*z) for x,z in zip(ox,oz)]
    # One constrained front patch bridges the rims; no duplicated seam vertices.
    coord=lambda i:(vertices[i][0],vertices[i][2])
    index={coord(i):i for ring in [front,*holes] for i in ring}
    polygon=Polygon([coord(i) for i in front],[[coord(i) for i in ring] for ring in holes])
    for tri in constrained_delaunay_triangles(polygon).geoms:
        ids=[index[tuple(q)] for q in tri.exterior.coords[:3]]
        a,b,c=(np.array(vertices[i]) for i in ids)
        if np.cross(b-a,c-a)[1]<0:ids.reverse()
        faces.append(ids)
    prev=front
    stations=[(.499,.22),(.495,-.24),(.433,-.46)] if game else [
        (.473,.365),(.489,.309),(.498,.22),(.5,.10),(.5,-.13),(.493,-.26),(.473,-.39),(.433,-.46)]
    for scale,y in stations:
        ring=[vertex(scale*x,y,scale*z) for x,z in zip(ox,oz)]
        bridge(prev,ring)
        prev=ring
    end=vertex(0,-.49,0)
    for j in range(shell_count):faces.append([end,prev[j],prev[(j+1)%shell_count]])
    return dict(v=np.asarray(vertices),f=np.asarray(faces),shade=np.asarray(tint))


def ring_profiles(path, size):
    shape=np.load(path)['v']
    # The source loft has horizontal rings and two cap centers.
    shape=((shape-shape.min(0))/np.ptp(shape,axis=0)-.5)*size
    result=[]
    for z in np.unique(shape[:,2]):
        xy=shape[shape[:,2]==z,:2]
        lo=xy.min(0);hi=xy.max(0)
        result.append([z+size[2]/2,*((hi+lo)/2),*((hi-lo)/2)])
    return np.asarray(result).T


def torso_profile(profile):
    # Fit squared radii with a smooth envelope that vanishes at both poles.
    # Interpolating the last narrow ring linearly makes a conical dimple.
    z, cx, cy, rx, ry = profile
    t = z/z[-1]
    basis = np.polynomial.legendre.legvander(2*t-1, 3)
    q = np.linspace(0,1,161)
    evaluate = np.polynomial.legendre.legvander(2*q-1,3)
    envelope = 4*t*(1-t)
    fitted = []
    for r in (rx,ry):
        coef = np.linalg.lstsq(basis*envelope[:,None],r*r,rcond=None)[0]
        radii = np.sqrt(np.maximum(0,4*q*(1-q)*(evaluate@coef)))
        fitted.append(radii * (r.max()/radii.max()))
    centers = []
    for c in (cx,cy):
        weights = envelope**2
        coef = np.linalg.lstsq(basis[:,:3]*weights[:,None], c*weights,rcond=None)[0]
        centers.append(evaluate[:,:3]@coef)
    return np.array([q*z[-1],*centers,*fitted])


def distances(inside,pitch):
    # The half-cell correction locates the exterior/interior interface between samples.
    d=distance_transform_edt(~inside,sampling=pitch)-distance_transform_edt(inside,sampling=pitch)
    return gaussian_filter(d-np.sign(d)*pitch*.5,1.0).astype('f4')


def make_body(root):
    pitch=.0045
    axes=[np.arange(a,b,pitch) for a,b in [(-.41,.41),(-.55,.34),(-.035,.62)]]
    x,y,z=np.meshgrid(*axes,indexing='ij',sparse=True)
    def occupancy(profile,cx,cy,h,leg=False):
        zs,dx,dy,rx,ry=profile
        local=z-h
        # Continue each proximal leg towards the trunk, tapering only once inside it.
        if leg:
            u=smoothstep((local-.14)/.205)
            sample=np.clip(local,.013,zs[-1]-.045)
            shoulder=1+.22*np.exp(-((local-.20)/.09)**2)
            width=shoulder*(1-.44*u)*np.sqrt(np.maximum(0,1-smoothstep((local-.27)/.105)))
            cx=cx*(1-.19*u);cy=cy+(-.113-cy)*.33*u
            allowed=(local>=-.017)&(local<=.37)
        else:
            sample=local; width=1.
            allowed=(local>=zs[0])&(local<=zs[-1])
        ax=np.maximum(.00001,np.interp(sample,zs,rx)*width)
        ay=np.maximum(.00001,np.interp(sample,zs,ry)*width)
        return allowed & (((x-cx-np.interp(sample,zs,dx))/ax)**2+
                          ((y-cy-np.interp(sample,zs,dy))/ay)**2 < 1)

    field=distances(occupancy(torso_profile(ring_profiles(root/'torso/loft.npz',[.695,.755,.497])),0,-.113,.0665),pitch)
    # Max blend radius at shoulders; below the pastern the feet remain independent.
    width=.132*smoothstep((z-.069)/.086)
    for pair,cx,cy,size in [('fore',.143,.166,[.167,.175,.26]),('hind',.213,-.282,[.181,.182,.256])]:
        prof=ring_profiles(root/'leg/loft.npz',size)
        for sign in (-1,1):
            leg=distances(occupancy(prof,sign*cx,cy,0,True),pitch)
            cleft=.013*np.exp(-((x-sign*cx)/.012)**2)*smoothstep((y-cy+.033)/.077)
            leg=np.maximum(leg,cleft-z)
            field=smooth_union(field,leg,width)
    field = gaussian_filter(field, 1.35)
    v,f,_,_=marching_cubes(-field.astype('f4'),0,spacing=(pitch,)*3,
                            gradient_direction='ascent',allow_degenerate=False)
    v+=np.array([a[0] for a in axes])
    return dict(v=v,f=f)
