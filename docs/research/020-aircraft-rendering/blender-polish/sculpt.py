"""Rework the cloned display mesh using editable section rings and preserve its entire animation."""
import bpy,bmesh,sys,json,math
from pathlib import Path
import numpy as np
from mathutils import Vector,Matrix
here=Path(__file__).resolve().parent; work=Path(sys.argv[sys.argv.index('--')+1])
s=bpy.context.scene;s.frame_set(0)
tables=json.loads((work/'tables.json').read_text())
spec=json.loads((here.parent/'part-atlases/calibration.json').read_text())
unit=6/583
parts={o.name:o for o in s.objects if o.type=='MESH'}
assert len(parts)==10
def lookup(k,v,p):
    curves=tables[k][v]
    return tuple(float(np.interp(p*np.size(c)-.5,np.arange(len(c)),c)) for c in curves)
def material(name,rgb,rough,metal,tex=None,factor=.5,coat=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    b=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    for socket,value in [('Base Color',(*rgb,1)),('Roughness',rough),('Metallic',metal),('Coat Weight',coat)]:
        b.inputs[socket].default_value=value
    if tex:
        t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(work/tex),check_existing=True);t.image.pack()
        inp=m.node_tree.nodes.new('ShaderNodeUVMap');inp.uv_map='Surface';m.node_tree.links.new(inp.outputs['UV'],t.inputs['Vector'])
        mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.inputs[0].default_value=factor;mix.inputs[1].default_value=(*rgb,1)
        m.node_tree.links.new(t.outputs['Color'],mix.inputs[2]);m.node_tree.links.new(mix.outputs[0],b.inputs['Base Color'])
    return m
paint={k:material(k+' · graphite skin',(.066,.075,.088),.48,.28,k+'-'+('left' if k=='fin' else 'top')+'.png',.50) for k in ('wing','canard','fin')}
edge=material('Satin edge trim',(.20,.218,.236),.34,.60)
frame=material('Canopy · graphite frame',(.036,.041,.049),.39,.32)
glass=material('Canopy · smoked amber',(.075,.028,.012),.155,.17,'canopy-top.png',.19,.52)
# Reuse the packed, part-specific roughness and seam-height maps on the new surface UVs.
tree=paint['wing'].node_tree;bs=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
uv=tree.nodes.new('ShaderNodeUVMap');uv.uv_map='Surface'
for name in ('wing-roughness.png','wing-relief.png'):
    tex=tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images[name];tex.extension='EXTEND'
    tree.links.new(uv.outputs['UV'],tex.inputs['Vector'])
    if 'roughness' in name:tree.links.new(tex.outputs['Color'],bs.inputs['Roughness'])
    else:
        b=tree.nodes.new('ShaderNodeBump');b.inputs['Strength'].default_value=.48;b.inputs['Distance'].default_value=.009
        tree.links.new(tex.outputs['Color'],b.inputs['Height']);tree.links.new(b.outputs['Normal'],bs.inputs['Normal'])
def rings(obj,sections,uvs,face_material,mats):
    n=len(sections[0]);count=len(sections)
    verts=[p for r in sections for p in r];faces=[];slots=[]
    for i in range(count-1):
        for j in range(n):
            faces.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
            slots.append(face_material(i,j))
    for i in (0,count-1):
        faces.append(tuple(i*n+j for j in (reversed(range(n)) if i==0 else range(n))));slots.append(1)
    mesh=bpy.data.meshes.new(obj.name+' · section cage')
    mesh.from_pydata(verts,[],faces);mesh.update()
    for m in mats:mesh.materials.append(m)
    uv=mesh.uv_layers.new(name='Surface')
    for f,mi in zip(mesh.polygons,slots):
        f.material_index=mi;f.use_smooth=(f.index<(count-1)*n)
        for loop in f.loop_indices:
            vi=mesh.loops[loop].vertex_index;uv.data[loop].uv=uvs[vi//n][vi%n]
    # Keep atlas projection UVs for paint and a non-overlapping editable layout for baking.
    atlas_uv=mesh.uv_layers.new(name='Bake')
    for face in mesh.polygons:
        if face.index<(count-1)*n:
            i,j=divmod(face.index,n)
            coords=[(.025+.95*a/(count-1),.17+.80*b/n) for a,b in ((i,j),(i,j+1),(i+1,j+1),(i+1,j))]
        else:
            pts=np.array([tuple(mesh.vertices[v].co) for v in face.vertices])
            _,_,basis=np.linalg.svd(pts-pts.mean(0),full_matrices=False)
            flat=(pts-pts.mean(0))@basis[:2].T
            flat-=flat.min(0);flat/=np.maximum(flat.max(0),1e-9)
            coords=flat*[.43,.115]+[.035 if face.index==(count-1)*n else .53,.025]
        for li,xy in zip(face.loop_indices,coords):
            atlas_uv.data[li].uv=xy
            if face.index>=(count-1)*n:uv.data[li].uv=xy
    mesh.uv_layers.active=atlas_uv;atlas_uv.active_render=True
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces[:]);bm.to_mesh(mesh);bm.free();mesh.update()
    obj.data=mesh
def wing_thickness(obj):
    dg=bpy.context.evaluated_depsgraph_get();o=obj.evaluated_get(dg);inv=o.matrix_world.inverted()
    x=(94-228.5)*unit;y=(105-291.5)*unit;hits=[]
    for z,d in ((4,-1),(-2,1)):
        hit,p,_,_=o.ray_cast(inv@Vector((x,y,z)),inv.to_3x3()@Vector((0,0,d)));assert hit
        hits.append((o.matrix_world@p).z)
    return hits[0]-hits[1]
baseline=wing_thickness(parts['Wing_L'])
# span radius, trailing/leading plan coordinates, section height, half-thickness.
wing=[(32,69,273,56,6.6),(42,69,271,56,6.6),(49,70,264,56,6.45),(65,71,234,55.8,6.4),
 (84,72,198,55,6.3),(95,73,180,54.6,6.27),(105,73,174,54.3,6.25),(132,72,159,53.7,6.2),
 (175,71,135,52,4.9),(207,71,118,50,3.6),(214,69,114,50.4,2.8),(217,63,112,53,2.4),
 (221,53,108,62,2.1),(225,44,102,72.5,1.8),(228,40,93,78.2,1.1)]
canard=[(24,284,353,44,3.2),(38,287,346,44,3.2),(49,285,335,44,3.0),(66,282,317,44.5,2.8),
 (78,279,305,45,2.4),(85,277,298,45,2.1),(87,277,294,45,1.7),(88,278,291,45,1.0)]
steps=np.array([0,.016,.06,.16,.32,.48,.65,.81,.94,.985,1])
ts=np.r_[steps,steps[-2:0:-1]]; signs=np.r_[np.ones(len(steps)),-np.ones(len(steps)-2)]
def surfaces(k,stations,vertical_scale):
    for side in ('L','R'):
        obj=parts[k.capitalize()+'_'+side];sgn=1 if side=='R' else -1;inv=obj.matrix_world.inverted()
        allr=[];alluv=[]
        for i,(rad,rear,nose,mid,half) in enumerate(stations):
            r=[];uv=[];u=(rad-stations[0][0])/(stations[-1][0]-stations[0][0])
            a,b=lookup(k,'top_rows',u)
            if k=="wing":mid-=float(np.interp(rad,[32,70,110,145,205],[0,1.2,2.2,2.0,0]))
            for t,sign in zip(ts,signs):
                dz=half*vertical_scale*math.sqrt(max(0,math.sin(math.pi*t)))*sign
                point=Vector(((225.9+sgn*rad-228.5)*unit,(rear+t*(nose-rear)-291.5)*unit,(mid+dz)*unit))
                r.append(tuple(inv@point));uv.append((u,1-(a+(b-a)*t)))
            allr.append(r);alluv.append(uv)
        rings(obj,allr,alluv,lambda i,j:int(min(ts[j],ts[(j+1)%len(ts)])>.975),[paint[k],edge])
surfaces('wing',wing,1);bpy.context.view_layer.update()
scale=baseline/wing_thickness(parts['Wing_L'])
surfaces('wing',wing,scale);surfaces('canard',canard,1)
# The fine trailing seam comes from the independent fin atlas. Give its skin clean section loops.
for side in ('L','R'):
    obj=parts['Fin_'+side];sgn=1 if side=='R' else -1;inv=obj.matrix_world.inverted()
    allr=[];alluv=[]
    for t in [0,.025,.12,.26,.42,.60,.76,.90,.975,1]:
        rear=28*(1-t)+1*t;front=157*(1-t)+36*t;rad=50+48.2*t
        r=[];uv=[]
        for chord,sign in zip(ts,signs):
            off=(5.1-3.05*t)*math.sqrt(max(0,math.sin(math.pi*chord)))*sign
            y=rear+(front-rear)*chord
            r.append(tuple(inv@Vector(((225.9+sgn*(rad+off)-228.5)*unit,(y-291.5)*unit,(69+86*t)*unit))))
            lo,hi=lookup('fin','left_cols',1-t)
            uv.append((hi+(lo-hi)*chord,t))
        allr.append(r);alluv.append(uv)
    rings(obj,allr,alluv,lambda i,j:int(min(ts[j],ts[(j+1)%len(ts)])>.975),[paint['fin'],edge])
# A continuous dome with a modeled base lip and one raised hoop, on the existing mount.
o=parts['Canopy'];w,d,h=np.array(spec['canopy']['dim'])*unit
stations=[.004,.014,.032,.06,.11,.19,.29,.39,.455,.466,.47,.49,.496,.502,.58,.68,.78,.86,.92,.96,.983,.996]
angles=np.linspace(-math.pi/2,math.pi/2,21)
allr=[];alluv=[]
for v in stations:
    lo,hi=lookup('canopy','top_cols',v);up,down=lookup('canopy','left_rows',1-v)
    rx=(hi-lo)*w/2;cx=((hi+lo)/2-.5)*w;floor=(1-down)*h
    rise=max(.02*h,(down-up)*h)
    hoop=.47<=v<=.49
    r=[];uv=[]
    for theta in angles:
        x=cx+rx*math.sin(theta)*(1.012 if hoop else 1)
        z=floor+.06*rise+math.cos(theta)*rise*(.95 if hoop else .92)
        r.append((x,(v-.5)*d,z));uv.append((x/w+.5,1-v))
    for x in [cx+rx*.98,cx-rx*.98]:
        r.append((x,(v-.5)*d,floor));uv.append((x/w+.5,1-v))
    allr.append(r);alluv.append(uv)
rings(o,allr,alluv,lambda i,j:int(j>=len(angles)-1 or .465<.5*(stations[i]+stations[i+1])<.499 or i in (0,len(stations)-2)),[glass,frame])
# Sample the clone itself at rings along the long axis. Smooth the angular contour
# within each section, retaining the canopy seat, joins and narrow nose.
o=parts['Fuselage'];old=o.data
pts=np.array([tuple(v.co) for v in old.vertices])
ymin,ymax=pts[:,1].min(),pts[:,1].max();span=ymax-ymin
fractions=np.unique(np.r_[.0005,.002,np.linspace(.008,.97,43),.984,.994,.9995])
allr=[];alluv=[];sides=[]
from mathutils.bvhtree import BVHTree
old.calc_loop_triangles()
bvh=BVHTree.FromPolygons([v.co for v in old.vertices],[tuple(t.vertices) for t in old.loop_triangles],all_triangles=True)
edges=np.array([e.vertices[:] for e in old.edges]);pa,pb=pts[edges[:,0]],pts[edges[:,1]]
for frac in fractions:
    y=ymin+span*frac
    selected=(np.minimum(pa[:,1],pb[:,1])<y)&(np.maximum(pa[:,1],pb[:,1])>=y)
    a,b=pa[selected],pb[selected];t=(y-a[:,1])/(b[:,1]-a[:,1])
    cut=a+t[:,None]*(b-a);lo=cut.min(0);hi=cut.max(0)
    origin=(lo+hi)/2;origin[1]=y
    ring=[]
    for theta in np.linspace(0,2*math.pi,32,endpoint=False):
        direction=np.array([math.cos(theta),0,math.sin(theta)])
        hit=bvh.ray_cast(Vector(origin+3*direction),Vector(-direction))[0]
        if hit is None:
            hit=origin+.5*(hi-lo)*direction
        ring.append(np.array(hit))
    ring=np.array(ring)
    for _ in range(3):
        ring=.5*ring+.25*(np.roll(ring,1,axis=0)+np.roll(ring,-1,axis=0))
    allr.append(ring)
# Smooth longitudinal sampling noise while retaining needle stations and end caps.
prev=np.array(allr)
for i in range(1,len(allr)-1):
    f=(fractions[i]-fractions[i-1])/(fractions[i+1]-fractions[i-1])
    allr[i]=prev[i]*.60+.40*((1-f)*prev[i-1]+f*prev[i+1])
w,d,h=np.array(spec['fuselage']['dim'])*unit
for ring in allr:
    alluv.append([(x/w+.5,.5-y/d) for x,y,z in ring])
hull=material('Fuselage · graphite fairing',(.046,.058,.074),.47,.32,'fuselage-top.png',.46)
rings(o,allr,alluv,lambda i,j:int(fractions[i]>.96),[hull,edge])
me=o.data
side_uv=me.uv_layers.new(name='Elevation')
for loop in me.loops:
    x,y,z=me.vertices[loop.vertex_index].co
    side_uv.uv[loop.index].vector=(.5-y/d,z/h)
tree=hull.node_tree
topnode=next(n for n in tree.nodes if n.type=='TEX_IMAGE')
mix=next(n for n in tree.nodes if n.type=='MIX_RGB')
def uvnode(uvmap):
    n=tree.nodes.new('ShaderNodeUVMap');n.uv_map=uvmap;return n.outputs['UV']
tree.links.new(uvnode('Surface'),topnode.inputs['Vector'])
elev=tree.nodes.new('ShaderNodeTexImage');elev.image=bpy.data.images.load(str(work/'fuselage-left.png'),check_existing=True);elev.image.pack()
tree.links.new(uvnode('Elevation'),elev.inputs['Vector'])
normal=tree.nodes.new('ShaderNodeNewGeometry');sep=tree.nodes.new('ShaderNodeSeparateXYZ')
tree.links.new(normal.outputs['Normal'],sep.inputs[0])
mixview=tree.nodes.new('ShaderNodeMixRGB')
tree.links.new(sep.outputs['Z'],mixview.inputs[0]);tree.links.new(elev.outputs['Color'],mixview.inputs[1])
tree.links.new(topnode.outputs['Color'],mixview.inputs[2]);tree.links.new(mixview.outputs[0],mix.inputs[2])
# Reduce baked glare on the retained parts while preserving their painted details.
for key in ('Nacelle_R','Nacelle_L'):
    mat=parts[key].data.materials[0]
    if mat.get('studio-finish'):continue
    mat['studio-finish']=True
    tree=mat.node_tree;b=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
    old=b.inputs['Base Color'].links[0].from_socket;mix=tree.nodes.new('ShaderNodeMixRGB')
    mix.inputs[0].default_value=.65;mix.inputs[1].default_value=(.056,.067,.081,1)
    tree.links.new(old,mix.inputs[2]);tree.links.new(mix.outputs[0],b.inputs['Base Color'])
    b.inputs['Metallic'].default_value=.36
# Resolve the original mirrored object scales without changing world geometry or pivots.
for ob in parts.values():
    if ob.scale.x*ob.scale.y*ob.scale.z<0:
        if ob.data.users>1: ob.data=ob.data.copy()
        mesh=ob.data;mat=Matrix.Diagonal(Vector((*ob.scale,1)))
        custom=mesh.has_custom_normals
        if custom:
            old_norm={(f.index,mesh.loops[i].vertex_index):mesh.corner_normals[i].vector.copy() for f in mesh.polygons for i in f.loop_indices}
        mesh.transform(mat);mesh.flip_normals();ob.scale=(1,1,1)
        if custom:
            m=mat.to_3x3().inverted().transposed();arr=[None]*len(mesh.loops)
            for f in mesh.polygons:
                for li in f.loop_indices:arr[li]=(m@old_norm[f.index,mesh.loops[li].vertex_index]).normalized()
            mesh.normals_split_custom_set(arr)
    if ob.name.startswith('Nacelle'):
        layer=ob.data.uv_layers.active
        for f in ob.data.polygons:
            loop=list(f.loop_indices);p=np.array([tuple(layer.data[i].uv) for i in loop])
            if len(p)==3 and abs(np.linalg.det(np.array([p[1]-p[0],p[2]-p[0]])))<1e-12:
                coords=p.mean(0)+np.array([[-1,-1],[1,-1],[0,1]])*.00010
                for i,xy in zip(loop,coords):layer.data[i].uv=xy
bpy.context.view_layer.update()
new=wing_thickness(parts['Wing_L']);assert abs(new-baseline)<1e-5,(new,baseline)
s.name='Aircraft · Blender Studio';s.frame_set(0);bpy.context.view_layer.objects.active=parts['Fuselage']
bpy.ops.object.select_all(action='DESELECT')
bpy.context.preferences.filepaths.save_version=0
assert bpy.ops.wm.save_as_mainfile(filepath=str(here/'Aircraft-Studio.blend'),compress=True)=={'FINISHED'}
print('Wing thickness',baseline,new)
