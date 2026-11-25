"""Re-open every GLB with Blender's importer and audit welded geometry."""
import bpy
import json
from pathlib import Path
import sys

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,sys.argv[sys.argv.index('--')+1])
import qa_check
report={}
for path in sorted((root/'models').glob('*.glb')):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path),merge_vertices=True)
    ob=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    report[path.stem]=qa_check.run(objects=[ob.name],profile='render',eps=.00002,tol=.002)
(root/'blender-qa.json').write_text(json.dumps(report,indent=2)+'\n')
