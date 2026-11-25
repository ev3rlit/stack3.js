"""Persist orthogonal RGBA slice sets, then reconstruct each experiment from those PNGs."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'scripts'))
from common import read_stack

m, source = read_stack('section-stack')
size = np.array(m['size'])
axes = {'x': (2, 0, 1), 'y': (1, 2, 0), 'z': (0, 1, 2)}  # layer, row, column in ZYX
layout = {
    'z72': ['z72'], 'x72': ['x72'], 'y72': ['y72'], 'xy72': ['x36','y36'],
    'zx72': ['z36','x36'], 'zy72': ['z36','y36'], 'xyz72': ['x24','y24','z24'],
    'xy144': ['x72','y72'], 'xyz216': ['x72','y72','z72'],
}
# Half of the native volume's texels split among the selected axes, rounding to whole layers.
matched = {'eq_z':['z36'],'eq_x':['x76'],'eq_y':['y96'],'eq_xy':['x38','y48'],
           'eq_zy':['z18','y48'],'eq_zx':['z18','x38'],'eq_xyz':['x25','y32','z12']}
scratch = Path(sys.argv[1])
scratch.mkdir(exist_ok=True, parents=True)
records = {}

def unpack(img, h, w, c, count):
    return img.reshape(-1,h,c,w,4).transpose(0,2,1,3,4).reshape(-1,h,w,4)[:count]

def write_set(key):
    axis = key[0]
    count = int(key[1:])
    view = source.transpose(*axes[axis],3)
    depth,h,w = view.shape[:3]
    # Pick uniformly spaced native cell centers, keeping their exact positions.
    indices = np.floor((np.arange(count)+.5)*depth/count).astype(int)
    assert len(set(indices)) == count
    cols = min(count, 4096//w)
    stored = np.zeros(((count+cols-1)//cols*cols,h,w,4),'uint8')
    stored[:count] = view[indices]
    img = stored.reshape(-1,cols,h,w,4).transpose(0,2,1,3,4).reshape(-1,cols*w,4)
    folder = HERE/'slices'/key
    folder.mkdir(exist_ok=True)
    Image.fromarray(img).save(folder/'stack.png',optimize=True)
    dims = size[[2-dim for dim in reversed(axes[axis])]].tolist()
    manifest = {**m,'columns':cols,'width':w,'depth':h,'layers':count,'size':dims,
        'spacing':dims[2]/count,'pivot':[0,0,dims[2]/2]}
    (folder/'stack.json').write_text(json.dumps(manifest,indent=2)+'\n')
    records[key] = dict(axis=axis,indices=indices.tolist(),native_depth=depth,texels=w*h*count)
    restored = unpack(np.asarray(Image.open(folder/'stack.png')),h,w,cols,count)
    assert np.array_equal(restored,view[indices])
    return restored[...,3].astype('float32')

def interpolate(key, layers):
    axis = key[0]; info = records[key]
    depth = info['native_depth']
    grid = np.arange(depth)
    pos = np.array(info['indices'])
    right = np.clip(pos.searchsorted(grid),0,len(pos)-1)
    left = np.clip(right-1,0,len(pos)-1)
    t = np.clip((grid-pos[left])/np.maximum(pos[right]-pos[left],1),0.,1.).astype('float32')
    field = layers[left]*(1-t[:,None,None])+layers[right]*t[:,None,None]
    distance = np.min(abs(grid[:,None]-pos[None,:]),axis=1) * size['xyz'.index(axis)]/depth
    shape = [1,1,1]; shape[axes[axis][0]] = depth
    return field.transpose(np.argsort(axes[axis])), distance.reshape(shape)

planes = {k: interpolate(k,write_set(k)) for k in sorted(set(sum(layout.values(),[])+sum(matched.values(),[])))}
truth = source[...,3]>=128
truth.astype('uint8').tofile(scratch/'voxel.bin')
source.tofile(scratch/'color.rgba')
for order in axes.values():
    native = source.transpose(*order,3)
    assert np.array_equal(native.transpose(*np.argsort(order),3),source)
volume_stats = {}
for name, keys in {**layout,**matched}.items():
    weight_sum = np.zeros(truth.shape,'float32')
    weighted = np.zeros_like(weight_sum)
    known = np.zeros(truth.shape,bool)
    values = np.zeros_like(weight_sum)
    for key in keys:
        field,distance = planes[key]
        weight = 1/np.maximum(distance,.0001)**2
        weighted += weight*field
        weight_sum += weight
        # Every observed plane is an exact constraint. At crossings the bytes are identical.
        np.copyto(values,field,where=(distance==0))
        known |= distance==0
    field = np.where(known,values,weighted/weight_sum)
    occupied = field>=128
    occupied.astype('uint8').tofile(scratch/(name+'.bin'))
    volume_stats[name] = dict(occupied=int(occupied.sum()), total_planes=sum(int(k[1:]) for k in keys),
        texels=sum(records[k]['texels'] for k in keys), field_iou=float((occupied&truth).sum()/(occupied|truth).sum()))
assert volume_stats['z72']['field_iou'] == volume_stats['xyz216']['field_iou'] == 1
(HERE/'experiment.json').write_text(json.dumps(dict(shape=list(source.shape[:3][::-1]),size=size.tolist(),
    slices=records,cases=layout,matched_texels=matched,volume=volume_stats),indent=2)+'\n')
