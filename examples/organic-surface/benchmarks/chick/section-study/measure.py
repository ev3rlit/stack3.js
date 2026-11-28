import json, struct
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np
root=Path(__file__).resolve().parent; base=root.parent
size=np.array(json.loads((base/'stack/stack.json').read_text())['size'])
def geometry(file):
    b=file.read_bytes(); l,=struct.unpack_from('<I',b,12)
    doc=json.loads(b[20:20+l]); offset=28+l
    prim=doc['meshes'][0]['primitives'][0]
    def read(key):
        a=doc['accessors'][key]; v=doc['bufferViews'][a['bufferView']]
        dt={5126:'<f4',5123:'<u2',5125:'<u4'}[a['componentType']]
        n={'VEC3':3,'SCALAR':1}[a['type']]
        return np.frombuffer(b,dt,a['count']*n,offset+v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,n)
    return read(prim['attributes']['POSITION']),read(prim['indices']).reshape(-1,3)


def main():
    result={}
    for name in ['A','B','R','C','D','C-lod','E64','E128','F','G','H','Hproj','F-lod','G-lod','Hproj-lod','L','L-lod','LR-lod','F3','LA-lod','B-raw','C-raw','D-raw','R-raw','E64-raw','E128-raw']:
        verts,faces=geometry(root/(name+'.glb')); vx,vy,vz=verts.T
        x=.5+vx/size[0]; y=.5-vz/size[1]; z=vy/size[2]
        scores={}
        feet_score=None
        for direction,(u,v) in dict(front=(x,1-z),rear=(1-x,1-z),left=(1-y,1-z),top=(x,y)).items():
            alpha=Image.open(root/'views'/(direction+'.png')).convert('RGBA').getchannel('A')
            w,h=alpha.size
            cover=Image.new('L',(w*2,h*2))
            draw=ImageDraw.Draw(cover)
            uv=np.rint(np.column_stack((u*w*2-.5,v*h*2-.5))).astype('int32')
            for tri in faces:draw.polygon(uv[tri].flatten().tolist(), fill=255)
            actual=np.asarray(cover.resize((w,h),Image.Resampling.BOX))>=128
            source=np.asarray(alpha)>=128
            scores[direction]=round(np.count_nonzero(actual & source)/np.count_nonzero(actual | source),5)
            if direction=='front':
                p,q = actual[round(.84*h):],source[round(.84*h):]
                feet_score=float(np.count_nonzero(p&q)/np.count_nonzero(p|q))
        result[name]=dict(triangles=len(faces),atlas_silhouette_iou=scores,front_lower_16pct_iou=feet_score)
        # Slice each triangle through a horizontal plane. Intersect the cut segments
        # with radial rays, retaining the outermost hit at each angle.
        tri=verts[faces]; h=tri[:,:,1]; plane=tri[:,:,[0,2]]
        vol = np.einsum('ij,ij->i',tri[:,0],np.cross(tri[:,1],tri[:,2])).sum()/6
        result[name]['signed_volume']=float(vol)
        lengths2=np.sum((tri-np.roll(tri,1,axis=1))**2,axis=2)
        area2=np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)
        quality=2*np.sqrt(3)*area2/lengths2.sum(axis=1)
        result[name]['triangle_quality_p10']=float(np.percentile(quality,10))
        angles=np.radians(np.arange(0,360,5))
        ux,uy=np.cos(angles),np.sin(angles)
        profiles=[]
        for height in np.arange(24,89)/128:  # fixed band; neighboring samples 1/128 apart
            spans=(h.min(axis=1)<height)&(h.max(axis=1)>=height)
            a=plane[spans]; ha=h[spans]
            b=np.roll(a,-1,axis=1); hb=np.roll(ha,-1,axis=1)
            edge=(ha<height)!=(hb<height)
            t=(height-ha[edge])/(hb[edge]-ha[edge])
            segs=(a[edge]+t[:,None]*(b[edge]-a[edge])).reshape(-1,2,2)
            A=segs[:,0]; D=segs[:,1]-A
            den=ux*D[:,1,None]-uy*D[:,0,None]
            with np.errstate(divide='ignore',invalid='ignore'):
                ray=(A[:,0]*D[:,1]-A[:,1]*D[:,0])[:,None]/den
                u=(A[:,0,None]*uy-A[:,1,None]*ux)/den
            radius=np.max(np.where((u>=0)&(u<=1)&(ray>0),ray,-np.inf),axis=0)
            assert np.isfinite(radius).all()
            profiles.append(radius)
        r=np.array(profiles)
        residual=r[4:-4]-(r[8:]+r[:-8])/2
        result[name]['torso_radial_residual_rms']=float(np.sqrt(np.mean(residual**2)))
        result[name]['mean_iou']=float(np.mean(list(scores.values())))
        result[name]['ground_z']=float(vy.min())
    for name,row in result.items():
        print(name,row['triangles'],*(round(row[k],6) for k in ('mean_iou','torso_radial_residual_rms','front_lower_16pct_iou','signed_volume','triangle_quality_p10')))
    (root/'metrics.json').write_text(json.dumps(result,indent=2)+'\n')


if __name__ == "__main__":
    main()
