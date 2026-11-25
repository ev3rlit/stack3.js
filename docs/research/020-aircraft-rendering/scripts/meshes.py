"""Extract meshes from the saved sprite-stack PNG; project the same four images on every surface."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as nd
import trimesh
from vtkmodules.util.numpy_support import numpy_to_vtk, vtk_to_numpy
from vtkmodules.vtkCommonDataModel import vtkImageData
from vtkmodules.vtkFiltersCore import vtkSurfaceNets3D, vtkFlyingEdges3D

from common import ROOT, NAMES, read_stack

cache = Path(sys.argv[1])
section = '--sections' in sys.argv
meta, tiles = read_stack('section-stack' if section else 'stack')
occ = np.ascontiguousarray(tiles[...,3]>=128)
dims = np.array(occ.shape[::-1])
size = np.array(meta['size'])
pitch, offset = size/dims, -size*np.array([.5,.5,0])
# GLB Y-up, converted back to the grid's right-handed Z-up by Blender import.
to_gltf = np.array([[1,0,0],[0,0,-1],[0,1,0]])

def nets():
    padded = np.pad(occ,1).astype('uint8')
    image = vtkImageData()
    image.SetDimensions(*padded.shape[::-1])
    image.SetOrigin(*(offset-.5*pitch))
    image.SetSpacing(*pitch)
    image.GetPointData().SetScalars(numpy_to_vtk(padded.ravel(),deep=True))
    if section:
        fraction=np.pad(tiles[...,3].astype('float32')/255,1)
        field=nd.gaussian_filter(fraction,(.7,.78,.78))
        # Reduce filtering on the tagged sub-voxel nose to retain its connected line.
        weight=np.clip((np.arange(field.shape[1])/dims[1]-.85)*18,0,.85)[None,:,None]
        field=(field*(1-weight)+fraction*weight).astype('float32')
        image.GetPointData().SetScalars(numpy_to_vtk(field.ravel(),deep=True))
        mc=vtkFlyingEdges3D()
        mc.SetInputData(image)
        mc.SetValue(0,.42)
        mc.Update()
        poly=mc.GetOutput()
        return trimesh.Trimesh(vtk_to_numpy(poly.GetPoints().GetData()),
            vtk_to_numpy(poly.GetPolys().GetConnectivityArray()).reshape(-1,3),process=True)
    sn = vtkSurfaceNets3D()
    sn.SetInputData(image)
    sn.SetValue(0,1)
    sn.SetOutputMeshTypeToTriangles()
    sn.SetTriangulationStrategyToMinEdge()
    sn.SmoothingOn()
    sn.AutomaticSmoothingConstraintsOff()
    sn.SetConstraintStrategyToConstraintDistance()
    sn.SetConstraintDistance(float(pitch.max()*1.8))
    sn.SetNumberOfIterations(24)
    sn.Update()
    poly = sn.GetOutput()
    return trimesh.Trimesh(vtk_to_numpy(poly.GetPoints().GetData()),
        vtk_to_numpy(poly.GetPolys().GetConnectivityArray()).reshape(-1,3),process=True)

def original(name):
    vert=np.fromfile(cache/(name+'.vertices'),dtype=np.float32).reshape(-1,3)
    faces=np.fromfile(cache/(name+'.triangles'),dtype=np.uint32).reshape(-1,3)
    return trimesh.Trimesh(vert*pitch+offset,faces,process=True)

directions=('top','left','front','rear')
images = []
for direction in directions:
    tile=np.asarray(Image.open(ROOT/f'inputs/{direction}.png'))
    # Extend silhouette-edge color into the transparent area for bilinear sampling.
    nearest=nd.distance_transform_edt(tile[...,3]<128,return_distances=False,return_indices=True)
    images.append(tile[tuple(nearest)][...,:3])
bounds=[]
atlas=Image.new('RGB',(sum(t.shape[1]+4 for t in images),max(t.shape[0] for t in images)+4))
left=2
for tile in images:
    h,w=tile.shape[:2]
    atlas.paste(Image.fromarray(np.pad(tile,((2,2),(2,2),(0,0)),mode='edge')),(left-2,0))
    bounds.append((left,2,w,h))
    left+=w+4
mat = trimesh.visual.material.PBRMaterial(name='Orthographic atlas',baseColorTexture=atlas,
    baseColorFactor=[255,255,255,255], metallicFactor=.22, roughnessFactor=.48, doubleSided=False)
# Smooth a shared copy of the occupancy only to choose the source texture at a face.
gradient=np.gradient(nd.gaussian_filter(occ.astype('float32'),(1.9,1.5,1.5)),*pitch[::-1])
def textured(mesh, name):
    vert,faces=mesh.vertices,mesh.faces
    unit=(vert-offset)/size
    points=unit[faces].mean(axis=1)
    coords=(points*dims-.5)[:,::-1].T
    normals=-np.stack([nd.map_coordinates(g,coords,order=1,mode='nearest') for g in gradient[::-1]],axis=1)
    # Favor the plan for dorsal skin. Use side and end images on steeper faces.
    nx,ny,nz=normals.T
    weights=np.column_stack([1.65*abs(nz),abs(nx),np.maximum(ny,0),np.maximum(-ny,0)])
    # Avoid mapping a face edge-on to a texture plane.
    axis=np.abs(mesh.face_normals)[:,[2,0,1,1]]
    weights=np.where(axis>.02,weights+axis*1e-6,-1.)
    which=weights.argmax(axis=1)
    face_count=len(faces)
    # Weld duplicates within each UV projection and normal group.
    hard=(np.argmax(abs(mesh.face_normals),axis=1)*2 + (mesh.face_normals.max(axis=1)>.5)) if name=='voxel' else np.zeros(face_count,int)
    keys=faces*24+which[:,None]*6+hard[:,None]
    codes, flat_faces=np.unique(keys,return_inverse=True)
    ids=codes//24
    view=(codes%24)//6
    x,y,z=unit[ids].T
    uv=np.zeros((len(ids),2))
    for k,(u,v) in enumerate(((x,y),(1-y,1-z),(x,1-z),(1-x,1-z))):
        sel=view==k
        px,py,w,h=bounds[k]
        uv[sel,0]=(px+.5+np.clip(u[sel],0,1)*(w-1))/atlas.width
        uv[sel,1]=1-(py+.5+np.clip(v[sel],0,1)*(h-1))/atlas.height
    vn=mesh.vertex_normals[ids]
    if name=='voxel':
        vn=np.zeros((len(ids),3))
        hard_code=codes%6
        vn[np.arange(len(vn)),hard_code//2]=np.where(hard_code%2,1.,-1.)
    result=trimesh.Trimesh(vert[ids]@to_gltf,flat_faces.reshape(-1,3),vertex_normals=vn@to_gltf,process=False,
        visual=trimesh.visual.texture.TextureVisuals(uv=uv,material=mat))
    result.metadata['units']='m'
    glb=trimesh.Scene({name:result}).export(file_type='glb')
    (ROOT/'models'/f'{name}.glb').write_bytes(glb)

base=nets()
for name in (('section-loft',) if section else NAMES):
    if name=='surface-nets':
        mesh=base.copy()
    elif name in ('surface-nets-qem','section-loft'):
        mesh=base.simplify_quadric_decimation(face_count=3600,aggression=5)
    else:
        mesh=original(name)
    if name=='surface-nets-qem':
        # A collapsed thin sheet can become two coincident faces with opposite
        # normals. Remove each cancelling pair before computing export normals.
        _,groups,counts=np.unique(np.sort(mesh.faces,axis=1),axis=0,return_inverse=True,return_counts=True)
        keep=counts[groups]==1
        if not np.all(keep):
            mesh.update_faces(keep)
            mesh.remove_unreferenced_vertices()
            trimesh.repair.fill_holes(mesh)
            trimesh.repair.fix_normals(mesh,multibody=True)
        # Discard disconnected remnants of a collapsed grid-width projection.
        # Report metrics after this cleanup so lost length counts against QEM.
        parts=mesh.split(only_watertight=False)
        if len(parts)>1:
            mesh=max(parts,key=lambda part:part.area)
    if mesh.volume<0: mesh.invert()
    print(name,len(mesh.faces),mesh.volume,mesh.is_watertight,flush=True)
    if section:
        from bake import bake
        result=bake(mesh,images,size,offset,to_gltf)
        (ROOT/'models'/f'{name}.glb').write_bytes(trimesh.Scene({name:result}).export(file_type='glb'))
    else:
        textured(mesh,name)
