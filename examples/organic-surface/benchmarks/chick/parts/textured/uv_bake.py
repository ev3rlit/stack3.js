"""Bake smoothly blended multi-view albedo onto disjoint UV triangles."""
import math
from pathlib import Path
import bpy
import numpy as np

def bake(obj, source_image, folder):
    mesh=obj.data
    part=obj.name.split('.')[0].lower()
    points=np.asarray([v.co[:] for v in mesh.vertices])
    points=(points-points.min(axis=0))/np.ptp(points,axis=0)
    normals=np.asarray([v.normal[:] for v in mesh.vertices])
    mirrored=obj.name.endswith('.R')
    if mirrored:
        points[:,0]=1-points[:,0]
        normals[:,0]*=-1
    fh,fw=source_image.size[1],source_image.size[0]
    pixels=np.empty(fw*fh*4,np.float32)
    source_image.pixels.foreach_get(pixels)
    source=pixels.reshape(fh,fw,4)[::-1,:,:3]
    columns=math.ceil(math.sqrt(len(mesh.polygons)))
    cell=32
    size=columns*cell
    baked=np.ones((size,size,4),dtype=np.float32)
    uv=mesh.uv_layers.new(name='AtlasUV')
    # One triangle per grid square, extrapolate edge colors through the gutters.
    coords=(np.arange(cell)+.5-3)/(cell-6)
    ax,ay=np.meshgrid(coords,coords)
    bw=np.maximum(np.stack([1-ax-ay,ax,ay],axis=2),0)
    bw/=bw.sum(axis=2,keepdims=True)
    for index,f in enumerate(mesh.polygons):
        ix=index%columns*cell;iy=index//columns*cell
        face=np.asarray(f.vertices)
        pos=bw@points[face];nor=bw@normals[face]
        weights=abs(nor)**3
        weights/=np.maximum(weights.sum(axis=2,keepdims=True),1e-9)
        x,y,z=pos.transpose(2,0,1)
        color=np.zeros((cell,cell,3))
        for axis in range(3):
            positive=nor[...,axis]>=0
            if axis==0:
                chart=np.where(positive,3,2);u=np.where(positive,y,1-y);v=1-z
            elif axis==1:
                chart=np.where(positive,0,1);u=np.where(positive,x,1-x);v=1-z
            else:
                chart=np.where(positive,4,5);u=x;v=y
            px=(chart%3)*266+5+np.clip(u,0,1)*255
            py=(chart//3)*266+5+np.clip(v,0,1)*255
            xx=px.astype(int);yy=py.astype(int)
            dx=(px-xx)[...,None];dy=(py-yy)[...,None]
            rgb=(1-dy)*((1-dx)*source[yy,xx]+dx*source[yy,xx+1])+dy*((1-dx)*source[yy+1,xx]+dx*source[yy+1,xx+1])
            color+=rgb*weights[...,axis,None]
        baked[iy:iy+cell,ix:ix+cell,:3]=color
        for k,(u,v) in zip(f.loop_indices,[(3,3),(cell-3,3),(3,cell-3)]):
            uv.data[k].uv=((ix+u)/size,(iy+v)/size)
    image=bpy.data.images.new(part+' baked albedo',width=size,height=size,alpha=False)
    image.colorspace_settings.name='sRGB'
    image.pixels.foreach_set(baked.ravel())
    image.filepath_raw=str(folder/(part+'-baked.png'));image.file_format='PNG';image.save()
    image.pack()
    return image
