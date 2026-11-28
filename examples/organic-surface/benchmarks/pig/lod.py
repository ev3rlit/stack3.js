"""Game-budget variant: preserve five-bone skinning; reduce ears in the open bind pose."""
from pathlib import Path
import bpy,sys
out=Path(__file__).resolve().parent
sys.path.insert(0,str(out))
from surface_materials import ground_soles,body_uv,snout_mesh
scene=bpy.context.scene
rig=bpy.data.objects['Piglet']
scene.frame_set(37)
# The ear gets preference over eyes and static surfaces in this LOD.
# Spend fixed loops on the small nose openings; give the remaining triangles
# to the welded body without dissolving the ear skinning.
nose=snout_mesh(out/'snout/game-surface.npz')
nose.materials.append(bpy.data.objects['Snout'].data.materials[0])
bpy.data.objects['Snout'].data=nose
budgets={'Head':234,'Curled tail':90,'Eye':42,'Ear':162}
budgets['Torso']=1600-len(nose.polygons)-sum(budgets[o.name.split('.')[0]] for o in rig.children if o.type=='MESH' and o.name not in ('Torso','Snout'))
for o in rig.children:
    if o.type!='MESH' or o.name=='Snout':continue
    budget=budgets[o.name.split('.')[0]]
    bpy.context.view_layer.objects.active=o
    o.data.calc_loop_triangles()
    original=len(o.data.loop_triangles)
    mod=o.modifiers.new('Game LOD','DECIMATE');mod.ratio=budget/original
    mod.use_collapse_triangulate=True
    bpy.ops.object.modifier_move_to_index(modifier=mod.name,index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if o.name=='Torso':
        ground_soles(o.data)
        body_uv(o.data)
    # Normalize all preserved ear deform groups after edge collapses.
    if o.name.startswith('Ear.'):
        for v in o.data.vertices:
            groups=[(g.group,g.weight) for g in v.groups if g.weight>0]
            total=sum(w for _,w in groups)
            assert total>0
            for idx,w in groups:o.vertex_groups[idx].add([v.index],w/total,'REPLACE')
scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for o in rig.children:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out/'piglet-game.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_anim_slide_to_zero=True)
