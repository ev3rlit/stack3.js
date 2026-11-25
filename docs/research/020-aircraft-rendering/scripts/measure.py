"""Evaluate the re-opened GLBs independently of mesh extraction and shading."""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as nd
import trimesh
from vtkmodules.util.numpy_support import numpy_to_vtk, numpy_to_vtkIdTypeArray, vtk_to_numpy
from vtkmodules.vtkCommonCore import vtkPoints
from vtkmodules.vtkCommonDataModel import vtkPolyData, vtkCellArray
from vtkmodules.vtkImagingStencil import vtkPolyDataToImageStencil, vtkImageStencilToImage
from common import ROOT, NAMES, read_stack, save_json

def iou(a,b):
    return float(np.count_nonzero(a&b)/np.count_nonzero(a|b))

def load_mesh(path):
    mesh=trimesh.load_scene(path).to_geometry()
    grid=np.column_stack((mesh.vertices[:,0],-mesh.vertices[:,2],mesh.vertices[:,1]))
    return trimesh.Trimesh(grid,mesh.faces,process=True)

def stencil(mesh,origin,pitch,dims):
    points=vtkPoints()
    points.SetData(numpy_to_vtk(np.ascontiguousarray(mesh.vertices),deep=True))
    cells=vtkCellArray()
    cells.SetData(numpy_to_vtkIdTypeArray(np.arange(len(mesh.faces)+1,dtype=np.int64)*3,deep=True),
        numpy_to_vtkIdTypeArray(np.ascontiguousarray(mesh.faces,dtype=np.int64).ravel(),deep=True))
    poly=vtkPolyData()
    poly.SetPoints(points)
    poly.SetPolys(cells)
    raster=vtkPolyDataToImageStencil()
    raster.SetInputData(poly)
    raster.SetOutputOrigin(*origin)
    raster.SetOutputSpacing(*pitch)
    raster.SetOutputWholeExtent(0,int(dims[0])-1,0,int(dims[1])-1,0,int(dims[2])-1)
    raster.SetTolerance(1e-7)
    convert=vtkImageStencilToImage()
    convert.SetInputConnection(raster.GetOutputPort())
    convert.SetInsideValue(1);convert.SetOutsideValue(0);convert.SetOutputScalarTypeToUnsignedChar()
    convert.Update()
    return vtk_to_numpy(convert.GetOutput().GetPointData().GetScalars()).reshape(tuple(dims[::-1])).astype(bool)

def silhouettes(mesh,size,offset):
    norm=(mesh.vertices-offset)/size
    x,y,z=norm.T
    result={}
    for name,(u,v) in zip(('top','left','front','rear'),((x,y),(1-y,1-z),(x,1-z),(1-x,1-z))):
        target=np.asarray(Image.open(ROOT/f'inputs/{name}.png'))[...,3]>=128
        h,w=target.shape
        # Fine raster reduces outward integer-pixel stroke bias. Use foreground area sampling.
        factor=4
        target_xy=np.column_stack((u*w,v*h))*factor-.5
        polys=np.rint(target_xy*16).astype('int32')[mesh.faces]
        raster=np.zeros((h*factor,w*factor),'uint8')
        for triangle in polys:
            cv2.fillConvexPoly(raster,triangle,255,shift=4)
        pred=cv2.resize(raster,(w,h),interpolation=cv2.INTER_AREA)>=128
        result[name]=iou(target,pred)
    return result

def sample_ellipsoid(dims,origin,pitch,size,offset):
    zz,yy,xx=np.ogrid[:dims[2],:dims[1],:dims[0]]
    q=[((var*pitch[k]+origin[k]-offset[k])/size[k]*2-1)**2 for k,var in enumerate((xx,yy,zz))]
    return q[0]+q[1]+q[2]<=1

def compare_models(render=None):
    m,stack=read_stack()
    shape=np.array(stack.shape[:3][::-1])
    size=np.array(m['size']); offset=-size*np.array([.5,.5,0]); factor=3
    pitch=size/shape/factor
    origin=offset+.5*pitch
    def expanded(a):
        return np.repeat(np.repeat(np.repeat(a,factor,0),factor,1),factor,2)
    base=expanded(stack[...,3]>=128)
    reference=sample_ellipsoid(shape*factor,origin,pitch,size,offset) if render is None else None
    if render:
        reference_photo=np.asarray(Image.open(ROOT/'inputs/reference-mask.png'))>127
    results={}
    for name in (*NAMES, *(('section-loft',) if render else ())):
        path=ROOT/'models'/f'{name}.glb'
        mesh=load_mesh(path)
        assert mesh.is_winding_consistent or mesh.volume>0
        grid=stencil(mesh,origin,pitch,shape*factor)
        target=expanded(read_stack('section-stack')[1][...,3]>=128) if name=='section-loft' else base
        ortho=silhouettes(mesh,size,offset)
        mesh_volume=abs(float(mesh.volume))
        data=dict(triangles=len(mesh.faces),bytes=path.stat().st_size,watertight=bool(mesh.is_watertight),
            bounds=mesh.bounds.tolist(), input_iou=ortho, mean_input_iou=float(np.mean(list(ortho.values()))),
            stack_volume_iou=iou(target,grid), base_hull_volume_iou=iou(base,grid),
            mesh_volume=mesh_volume, source_stack_cells=int(target.sum()//factor**3))
        if reference is not None:
            data['known_model_iou']=iou(reference,grid)
            data['signed_volume_error_percent']=100*(mesh_volume/(np.pi*np.prod(size)/6)-1)
        else:
            rgba=np.asarray(Image.open(render/f'{name}-eevee.png').convert('RGBA'))
            pred=rgba[...,3]>=128
            aa=reference_photo&~nd.binary_erosion(reference_photo)
            bb=pred&~nd.binary_erosion(pred)
            distances=np.r_[nd.distance_transform_edt(~aa)[bb],nd.distance_transform_edt(~bb)[aa]]
            data.update(photo_iou=iou(reference_photo,pred), photo_boundary_p95_px=float(np.percentile(distances,95)),
                photo_recall=float((reference_photo&pred).sum()/reference_photo.sum()),
                photo_precision=float((reference_photo&pred).sum()/pred.sum()))
        results[name]=data
        print(name,data['triangles'],data['stack_volume_iou'],data['mean_input_iou'],data.get('photo_iou',data.get('known_model_iou')),flush=True)
    assert abs(results['voxel']['stack_volume_iou']-1)<1e-6
    return results

def compare_shading(render):
    names=['cpu','webgl','unlit','clay','eevee','cycles']
    rgba={}
    native={}
    target=Image.open(render/'section-loft-cycles.png').size
    for k in names:
        img=Image.open(render/f'section-loft-{k}.png').convert('RGBA')
        native[k]=img.size
        rgba[k]=np.asarray(img if img.size==target else img.resize(target,Image.Resampling.LANCZOS))
    common=nd.binary_erosion(np.logical_and.reduce([r[...,3]>=254 for r in rgba.values()]),iterations=2)
    truth=rgba['cycles']
    result={}
    for k,r in rgba.items():
        delta=(r[...,:3].astype(float)-truth[...,:3])[common]
        result[k]=dict(native_resolution=native[k],rgb_mae_8bit=float(np.mean(abs(delta))), rgb_rmse_8bit=float(np.sqrt(np.mean(delta**2))),
            silhouette_iou_vs_cycles=iou(r[...,3]>=128,truth[...,3]>=128), comparison_pixels=int(common.sum()))
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--render',type=Path)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    results=dict(sampling_per_stack_cell=[3,3,3],models=compare_models(args.render))
    if args.render: results['renderer_difference']=compare_shading(args.render)
    save_json(args.out,results)
