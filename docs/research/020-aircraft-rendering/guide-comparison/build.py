"""Vary the saved occupancy input; run the same geometry and texture pipeline twice."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd
import trimesh
from vtkmodules.util.numpy_support import numpy_to_vtk, vtk_to_numpy
from vtkmodules.vtkCommonDataModel import vtkImageData
from vtkmodules.vtkFiltersCore import vtkFlyingEdges3D

HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'scripts'))
from bake import bake
from common import read_stack, save_json

def color_image(name):
    rgba=np.asarray(Image.open(HERE.parent/'inputs'/f'{name}.png'))
    nearest=nd.distance_transform_edt(rgba[...,3]<128,return_distances=False,return_indices=True)
    return rgba[tuple(nearest)][...,:3]

def extract(mask, size):
    dims=np.array(mask.shape[::-1])
    pitch=size/dims
    offset=-size*np.array([.5,.5,0])
    padded=np.pad(mask.astype('float32'),1)
    field=nd.gaussian_filter(padded,(.7,.78,.78))
    # Same nose-preserving filter and iso-value as the earlier section model.
    keep=np.clip((np.arange(field.shape[1])/dims[1]-.85)*18,0,.85)[None,:,None]
    field=(field*(1-keep)+padded*keep).astype('float32')
    grid=vtkImageData()
    grid.SetDimensions(*field.shape[::-1])
    grid.SetOrigin(*(offset-.5*pitch))
    grid.SetSpacing(*pitch)
    grid.GetPointData().SetScalars(numpy_to_vtk(field.ravel(),deep=True))
    mc=vtkFlyingEdges3D()
    mc.SetInputData(grid)
    mc.SetValue(0,.42)
    mc.Update()
    poly=mc.GetOutput()
    mesh=trimesh.Trimesh(vtk_to_numpy(poly.GetPoints().GetData()),
        vtk_to_numpy(poly.GetPolys().GetConnectivityArray()).reshape(-1,3),process=True)
    parts=mesh.split(only_watertight=False)
    main=max(parts,key=lambda m:m.area)
    result=main.simplify_quadric_decimation(face_count=3600,aggression=5)
    if result.volume<0: result.invert()
    return result,offset,len(parts)

images=[color_image(name) for name in ('top','left','front','rear')]
rotate=np.array([[1,0,0],[0,0,-1],[0,1,0]])
stats={}
for key,folder in [('off','stack'),('on','section-stack')]:
    meta,rgba=read_stack(folder)
    size=np.array(meta['size'])
    mask=rgba[...,3]>=128
    mesh,offset,components=extract(mask,size)
    assert len(mesh.faces)==3600
    textured=bake(mesh,images,size,offset,rotate)
    (HERE/'models'/f'guide-{key}.glb').write_bytes(trimesh.Scene({f'guide-{key}':textured}).export(file_type='glb'))
    stats[key]=dict(triangles=len(mesh.faces),occupied_cells=int(mask.sum()),size=size.tolist(),
        components_before_cleanup=components,mesh_volume=float(mesh.volume))
save_json(HERE/'build.json',stats)
