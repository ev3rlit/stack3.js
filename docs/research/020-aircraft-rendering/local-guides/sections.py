"""Create a local negative RGBA stack and extract its cutter surface from the saved PNG."""
import json
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage as nd
from vtkmodules.util.numpy_support import numpy_to_vtk, vtk_to_numpy
from vtkmodules.vtkCommonDataModel import vtkImageData
from vtkmodules.vtkFiltersCore import vtkFlyingEdges3D

here=Path(__file__).resolve().parent
sys.path.insert(0,str(here.parent/'scripts'))
from common import read_stack, save_json
from measure import load_mesh

def guide_coverage(source, xs, ys, zs, pitch):
    """Landmarks use TOP pixels and the registered elevation coordinate scale."""
    z,y,x=np.ix_(zs,ys,xs)
    size=np.array([4.703259005145798,6,1.8010291595197256])
    unit=6/583
    # Recover the existing upper skin for each sample column near the drawn openings.
    xx,yy=np.meshgrid(xs,ys)
    roof=np.zeros(xx.shape)
    area=(yy>127)&(yy<192)&((abs(xx-194)<15)|(abs(xx-258)<15))
    ray_origins=np.column_stack((xx[area]*unit-size[0]/2,yy[area]*unit-3,np.full(area.sum(),4.)))
    targets=np.tile([0.,0.,-1.],(len(ray_origins),1))
    hits,ids,_=source.ray.intersects_location(ray_origins,targets)
    heights=np.zeros(len(ray_origins))
    np.maximum.at(heights,ids,hits[:,2]/unit)
    roof[area]=heights
    # Silhouette around the two dark TOP areas. Depth and taper are visual assumptions.
    stations=[131.7,134,138,147,156,170,183.5,186.2]
    halfwidth=np.interp(y,stations,[0,4.2,7.8,9.6,8.8,6.4,3.1,0],left=0,right=0)
    center=np.interp(y,stations,[194,194,193.8,193,193.8,194.2,194.6,195.1])
    dist=np.minimum(abs(x-center),abs(x-(451.8-center)))
    edge=halfwidth-dist-.85*(1-np.exp(-np.maximum(0,roof-z)/1.25))
    depth=np.interp(y,stations,[0,10,15,14,11,7.2,2.3,0],left=0,right=0)
    floor=roof-depth*(.77+.23*np.clip(1-(dist/np.maximum(halfwidth,1))**2,0,1))
    scoop=np.minimum.reduce(np.broadcast_arrays(edge,z-floor,roof+10-z,y-stations[0],stations[-1]-y))
    # End-view ring proportions mapped to the two existing nacelle centers. Blind, tapered cups.
    dx=np.minimum(abs(x-199),abs(x-256))
    t=np.clip((y-3)/24,0,1)
    rim=np.exp(-np.maximum(0,y-3)/1.6)
    radius_x=9.2-2.2*t+1.0*rim; radius_z=10.0-2.1*t+1.1*rim
    radial=np.sqrt((dx/radius_x)**2+((z-61.5)/radius_z)**2)
    cup=np.minimum.reduce(np.broadcast_arrays((1-radial)*radius_x,28.5-y-1.7*np.minimum(radial,1)**2,y+8))
    sdf=np.maximum(scoop,cup)
    alpha=np.rint(255*np.clip(.5+sdf/pitch,0,1)).astype('uint8')
    return alpha

work=Path(sys.argv[1]);work.mkdir(exist_ok=True,parents=True)
# A small sRGB texture keeps the constant liner visible in stack3's map-based CPU preview.
linear=np.array([.033,.041,.050])
rgb=tuple(np.rint(255*(1.055*linear**(1/2.4)-.055)).astype(int))
Image.new('RGB',(2,2),rgb).save(work/'liner.png')
source=load_mesh(here.parent/'guide-comparison/models/guide-on.glb')
meta,_=read_stack('section-stack')
size=np.array(meta['size'])
unit=6/583
start=np.array([174.,-12.,37.])
dims=np.array([86,175,71])
pitch=1.2
coords=[v+(np.arange(n)+.5)*pitch for v,n in zip(start,dims)]
alpha=guide_coverage(source,*coords,pitch)
h,d,w=alpha.shape;c=min(h,4096//w)
tiles=np.zeros((((h+c-1)//c)*c,d,w,4),'uint8')
tiles[:h,...,3]=alpha
tiles[:h,...,:3]=np.where(alpha[...,None]>0,np.array([128,151,163],dtype='uint8'),0)
atlas=tiles.reshape(-1,c,d,w,4).transpose(0,2,1,3,4).reshape(-1,c*w,4)
folder=here/'recess-stack'
Image.fromarray(atlas).save(folder/'stack.png',optimize=True)
manifest={**meta,'width':w,'depth':d,'layers':h,'columns':c,'size':(dims*pitch*unit).tolist(),'spacing':pitch*unit}
save_json(folder/'stack.json',manifest)
# Re-read the stored stack; its alpha is the only geometry input to this extraction.
manifest=json.loads((folder/'stack.json').read_text())
stored=np.asarray(Image.open(folder/manifest['atlas'])).reshape(-1,d,c,w,4).transpose(0,2,1,3,4).reshape(-1,d,w,4)[:h,...,3]
assert np.array_equal(alpha,stored)
field=nd.gaussian_filter(np.pad(stored.astype('float32')/255,1),.55)
grid=vtkImageData()
grid.SetDimensions(*field.shape[::-1])
grid.SetOrigin(*((start-.5*pitch)*unit-size*np.array([.5,.5,0])))
grid.SetSpacing(*([unit*pitch]*3))
grid.GetPointData().SetScalars(numpy_to_vtk(field.ravel(),deep=True))
mc=vtkFlyingEdges3D();mc.SetInputData(grid);mc.SetValue(0,.5);mc.Update()
poly=mc.GetOutput()
mesh=trimesh.Trimesh(vtk_to_numpy(poly.GetPoints().GetData()),vtk_to_numpy(poly.GetPolys().GetConnectivityArray()).reshape(-1,3),process=True)
assert len(mesh.split())==4
mesh=mesh.simplify_quadric_decimation(face_count=1450,aggression=4)
trimesh.repair.fix_normals(mesh,multibody=True)
assert mesh.is_volume and mesh.is_watertight and len(mesh.split())==4
np.savez(work/'cutter.npz',vertices=mesh.vertices,faces=mesh.faces)
save_json(here/'placement.json',dict(origin_pixels=start.tolist(),pixel_step=pitch,source_pixels_per_length=583/6,
    samples_xyz=dims.tolist(),nonempty_layers=int(np.any(alpha>=128,axis=(1,2)).sum()),
    cutter_triangles=len(mesh.faces),components=4))
