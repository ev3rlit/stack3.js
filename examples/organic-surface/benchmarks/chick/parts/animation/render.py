"""Render a studio sequence from the saved Blender file; resumable within one render directory."""
from pathlib import Path
import os,sys
import bpy

dest=Path(sys.argv[-1]);dest.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
p=bpy.context.preferences.addons['cycles'].preferences
for backend in ['METAL','OPTIX','CUDA','HIP']:
    if backend not in [row[0] for row in p.get_device_types(bpy.context)]:continue
    p.compute_device_type=backend;p.refresh_devices()
    if any(d.type==backend for d in p.devices):
        for d in p.devices:d.use=d.type==backend
        scene.cycles.device='GPU'
        break
scene.render.use_persistent_data=True
frames=[int(i) for i in os.environ['POSES'].split(',')] if os.environ.get('POSES') else range(scene.frame_start,scene.frame_end+1)
for f in frames:
    path=dest/f'{f:04}.png'
    if path.exists():continue
    scene.frame_set(f);scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)
