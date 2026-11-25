"""Color the re-extracted surfaces with the same RGBA data, then verify exported GLBs."""
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as nd
import trimesh

HERE = Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'scripts'))
from common import read_stack
from measure import load_mesh, stencil

work=Path(sys.argv[1])
setup=json.loads((HERE/'experiment.json').read_text())
manifest, source=read_stack('section-stack')
dims=np.array(setup['shape'])
size=np.array(setup['size'])
pitch=size/dims
offset=np.array([-.5*size[0],-.5*size[1],0])
truth=source[...,3]>=128
nearest=nd.distance_transform_edt(~truth,return_distances=False,return_indices=True)
bleed=source[tuple(nearest)][...,:3]
truth_fine=np.repeat(np.repeat(np.repeat(truth,3,0),3,1),3,2)
def unlit_material(tree):
    tree['extensionsUsed']=['KHR_materials_unlit']
    tree['materials']=[{'name':'Stack RGBA','extensions':{'KHR_materials_unlit':{}},'doubleSided':True,
        'pbrMetallicRoughness':{'metallicFactor':0,'roughnessFactor':1}}]
    for item in tree['meshes']:
        for primitive in item['primitives']:
            primitive['material']=0

stats={}
for name in [*setup['cases'],'voxel']:
    xyz=np.fromfile(work/(name+'.xyz'),np.float32).reshape(-1,3)
    faces=np.fromfile(work/(name+'.tri'),np.uint32).reshape(-1,3)
    points=xyz*pitch+offset
    gltf=np.column_stack((points[:,0],points[:,2],-points[:,1]))
    if name=='voxel':
        # stack3 emits four private vertices for each exposed face, in groups of six indices.
        four=xyz.reshape(-1,4,3)
        # Winding of the first triangle gives the outward sign on both sides.
        first=xyz[faces[::2]]
        normal=np.cross(first[:,1]-first[:,0],first[:,2]-first[:,0])
        ijk=np.clip(np.floor(four.mean(axis=1)-.25*normal).astype(int),0,dims-1)
        rgb=np.repeat(bleed[ijk[:,2],ijk[:,1],ijk[:,0]],4,axis=0)/255.
    else:
        coord=(xyz[:,::-1]-.5).T
        rgb=np.stack([nd.map_coordinates(bleed[...,i],coord,order=1,mode='nearest') for i in range(3)],axis=1)/255.
    # glTF COLOR_0 is linear. All visible modes use unlit color to isolate slicing.
    linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
    rgba=np.column_stack((np.rint(linear*255),np.full(len(xyz),255))).astype('uint8')
    mesh=trimesh.Trimesh(gltf,faces,vertex_colors=rgba,process=False)
    path=HERE/'models'/(name+'.glb')
    path.write_bytes(trimesh.exchange.gltf.export_glb(mesh.scene(),tree_postprocessor=unlit_material))
    check=load_mesh(path)
    predicted=stencil(check,offset+pitch/6,pitch/3,dims*3)
    scores=dict(triangles=len(check.faces),mesh_iou=float((predicted&truth_fine).sum()/(predicted|truth_fine).sum()))
    stats[name]=scores
    print(name,scores,flush=True)
assert stats['voxel']['mesh_iou']==1 and stats['z72']==stats['xyz216']
(HERE/'mesh-results.json').write_text(json.dumps(stats,indent=2)+'\n')
