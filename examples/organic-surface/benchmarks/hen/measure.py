"""Orthographic silhouette and feature measurements on the delivered GLB triangles."""
import json,struct
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy.signal import find_peaks

root=Path(__file__).resolve().parent
def geometry(path):
    raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+length]);base=28+length
    def accessor(i):
        a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']]
        dtype={5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']]
        count={'VEC3':3,'SCALAR':1}[a['type']]
        assert 'byteStride' not in v
        return np.frombuffer(raw,dtype,count*a['count'],base+v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,count)
    data={}
    # The assembler bakes scale and reflection into each mesh and uses a translation-only hierarchy.
    def visit(i,origin):
        n=doc['nodes'][i]
        assert 'matrix' not in n and 'rotation' not in n and 'scale' not in n
        center=origin+np.asarray(n.get('translation',[0,0,0]))
        if 'mesh' in n:
            prim,=doc['meshes'][n['mesh']]['primitives']
            v=accessor(prim['attributes']['POSITION'])+center
            data[n['name']]=(v[:,[0,2,1]]*[1,-1,1],accessor(prim['indices']).reshape(-1,3))
        for c in n.get('children',[]):visit(c,center)
    for i in doc['scenes'][doc.get('scene',0)]['nodes']:visit(i,np.zeros(3))
    return data

def view(v,side):
    x,y,z=v.T
    return np.column_stack({'front':(x,1-z),'rear':(-x,1-z),'left':(-y,1-z),'top':(x,y)}[side])
def raster(assets,kind,wh,normalize):
    w,h=wh
    im=Image.new('L',(w*2,h*2));draw=ImageDraw.Draw(im)
    for v,f in assets:
        uv=normalize(view(v,kind))
        pix=np.rint(uv*[w*2,h*2]-.5).astype(int)
        for tri in pix[f]:
            draw.polygon(tri.ravel().tolist(),fill=255)
    return np.asarray(im.resize((w,h),Image.Resampling.BOX))>=128
ref={side: np.asarray(Image.open(root/'whole'/(side+'.png')))[1:-1,1:-1,3]>127 for side in ('front','left','top','rear')}
H,W=ref['front'].shape; hl,wl=ref['left'].shape; ht,wt=ref['top'].shape
depth=wl/hl;width=(W/H+depth*wt/ht)/2
def mask_ref(part,side):
    return np.asarray(Image.open(root/part/(side+'.png')))[1:-1,1:-1,3]>127
def measure(path):
    data=geometry(path)
    result={}
    for side,target in ref.items():
        h,w=target.shape
        scale=[depth if side=='left' else width,depth if side=='top' else 1]
        offset=[.5,.5 if side=='top' else 0]
        # Include overshoots beyond the fitted input bounds.
        pad=24
        normalize=lambda uv:((uv/scale+offset)*[w,h]+pad)/[w+2*pad,h+2*pad]
        a=raster(data.values(),side,(w+2*pad,h+2*pad),normalize)
        b=np.pad(target,pad)
        result[side+'_iou']=float((a&b).sum()/(a|b).sum())
    for name,side,lower in [('Comb','left',False),('Wattle','front',True)]:
        target=mask_ref(name.lower(),side)
        mesh=data[name];projected=view(mesh[0],side)
        pred=raster([mesh],side,target.shape[::-1],lambda uv:(uv-projected.min(0))/np.ptp(projected,axis=0))
        def peaks(mask):
            a=mask[::-1] if lower else mask
            heights=1-a.argmax(axis=0)/a.shape[0]
            return len(find_peaks(heights,prominence=.008,distance=.12*a.shape[1])[0])
        result[name]={'fitted_contour_iou':float((pred&target).sum()/(pred|target).sum()),
                      'atlas_tips':peaks(target),'mesh_tips':peaks(pred)}
    wattle=data['Wattle']
    v=wattle[0]
    target=mask_ref('wattle','left')
    projected=view(v,'left')
    side_mask=raster([wattle],'left',target.shape[::-1],lambda uv:(uv-projected.min(0))/np.ptp(projected,axis=0))
    result['Wattle']['assembled_depth_height']=float(np.ptp(v[:,1])/np.ptp(v[:,2]))
    result['Wattle']['left_fitted_contour_iou']=float((side_mask&target).sum()/(side_mask|target).sum())
    return result
if __name__=='__main__':
    results={p.name:measure(p) for p in [root/'hen.glb',root/'hen-game.glb']}
    (root/'silhouettes.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(results,indent=2))
