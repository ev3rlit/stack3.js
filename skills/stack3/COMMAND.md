# stack3 command reference

Generated from the CLI when packaging. Recipe paths are relative to this document.

## CLI help

```text
Usage: stack3 <verb> <input> [options]

  help [topic]           Show command help (pipeline, mesh, or capabilities)
  capabilities [--json]  List mesh methods, runtime requirements, schemas and example recipes
  example <name>         Copy future-tank or traffic-cone into the current directory
  verify -f <manifest>   Measure atlas views and mounts in one JSON report
  inspect <input>        Check mapped directions and fitted image sizes
  build <input>          Build an asset and save it to --output
  pipeline --help        Render or run YAML, or export its JSON Schema
  mesh <stack-directory> Extract a surface from saved stack.png + stack.json (--output mesh.glb)
                        --mesh-method marching-cubes (default), surface-nets, voxel
                        or section-loft, heightfield, smooth-loft, revolve, extended-mc, hermite-dc, mc33, branch-loft, path-sweep, section-network, greedy, monotone, signed-distance-dc
                        --guide <part.json> uses pivot-relative stack XYZ scene units.
                        section-loft, smooth-loft, branch-loft, heightfield: optional axis (x/y/z, default z)
                        section-loft, smooth-loft: optional stations [{slice,outer?,holes?}]
                        revolve: axis + origin, optional segments (8-512, default 64)
                        path-sweep: path; optional up and profile {outer,holes?} (defaults to first stack section)
                        section-network: sections [{source:"independent",origin,u,v,outer,holes?}], optional tolerance
                        hermite-dc: optional field (.npy SDF) or dexel (.npz crossings and normals)
                        signed-distance-dc: optional field, outerIterations and innerIterations
                        extended-mc, mc33, greedy, monotone: no guide
                        New methods use uv or STACK3_PYTHON. See the stack3 skill for guide examples.
  view <directory>       Open a stack bundle in Blender (use --web for the browser viewer)
                        --output scene.blend saves a named scene; add --no-open for headless export
                        --no-open alone prints the web preview URL
  project --help        Edit a level and control its live viewer and playground

Inputs
  PNG atlas              Supply --layout top,left,front,rear (add right,bottom for six views)
  JSON manifest          Map directions to separate PNG paths under "views"

Build options
  --format glb|stack     Write a GLB file or a directory with stack.png and stack.json
                        Can be omitted when --output ends in .glb
  --output <path>        Required output path
  --texture-projection <name>  auto (default) or top-contour for GLB output
  --mesh-method <name>   marching-cubes (default) or contour for GLB output
  --contour-hub          Add a centered round axle measured from TOP and LEFT
  --layers <integer|native>  Vertical samples (default 128)
  --spacing <number>     Sprite stack spacing multiplier (default 1)
  --profile <name>       silhouette, round, or round-base
  --verification <file>  Require a matching atlas PASS report before building
  --no-cache             Bypass the local build cache
  --resolution <integer|native>  Longer horizontal axis samples (default 96)
  --height <number>      Asset height in scene units (default 1)
  --pivot ground|center  Origin position (default ground)
  --threshold <0–255>    Background threshold for opaque PNGs (default 238)
```

## Verification

```text
stack3 verify -f <manifest.yaml> [--output-dir <dir>]
  Print one JSON measurement report to stdout.
  Atlas: projections and landmarks. Assembly: whole and part atlases plus mount measurements.
  A full atlas run reports an acceptance verdict. Use --output-dir to prepare a report for build --verification.
  --output-dir <dir>  Also save report.json and annotated PNG overlays
  -f, --file          Image and child manifest paths are relative to their YAML file.
```

## YAML pipelines

```text
Usage: stack3 pipeline <render|run> <pipeline.yaml> [-f <values.yaml> ...]
       stack3 pipeline schema [recipe|fragment]
  render   Resolve includes and values, then print the validated pipeline YAML.
  run      Execute the same resolved pipeline and write its GLB outputs.
  schema   Print a standalone JSON Schema. The default is recipe.
  -f, --values   Override defaults in order. The last file takes precedence.

Nodes: load-stack, reconstruct-stack, extract-mesh, write-glb.
Run stack3 capabilities --json for backends, guide fields and sample paths.
```

## Pipeline capabilities

```text
Usage: stack3 capabilities [--json]
List pipeline nodes, mesh methods, backends, schemas and runnable samples.

Pipeline nodes: load-stack, reconstruct-stack, extract-mesh, write-glb
Mesh methods: marching-cubes, surface-nets, voxel, section-loft, heightfield, smooth-loft, revolve, extended-mc, hermite-dc, mc33, branch-loft, path-sweep, section-network, greedy, monotone, signed-distance-dc

Geometry and export stages
  Voxel Reconstruction (node)   reconstruct-stack, load-stack
  SDF and Normal Estimation (python)   hermite-dc, signed-distance-dc
  Triple-Dexel Hermite Data (python)   guide.dexel, hermite-dc
  Feature Segmentation and Plane Fitting (python)   fitTolerance
  Primitive Fitting (python)   fitTolerance, primitives
  Feature Boundary Stitching (python)   fitTolerance
  Guided Geometry Regularization (python)   regularization.tolerance, regularization.features, regularization.relations
  Procedural Bevel (blender)   bevelWidth, bevelSegments
  Selective Rim Bevel after QEM (blender)   lodBevel.preTriangleBudget, lodBevel.rims, triangleBudget, bevelWidth, bevelSegments
  Mesh Optimization and LOD (blender)   dissolveAngle, triangleBudget
  Multi-view Texture Projection (node or python)   extract-mesh
  Weighted Normals (python)   extract-mesh, finish
  Ambient Occlusion (blender)   aoRadius
  GLB Export and GPU Instancing (node)   write-glb, lit, instances

JSON Schemas
  stack3 pipeline schema recipe
  stack3 pipeline schema fragment

Bundled recipes
  atlas-preview (node)
    references/hard-surface/atlas/preview.pipeline.yaml
  finish-lod (node, python, blender)
    references/hard-surface/finishing/finish-lod.pipeline.yaml
  guided-regularization (node, python)
    references/hard-surface/finishing/regularize.pipeline.yaml
  benchmark-beveled-lod (node, python, blender)
    references/hard-surface/case-studies/benchmark/lod-bevel.pipeline.yaml
  triple-dexel (node, python)
    references/hard-surface/measured-depth/triple-dexel/compare.pipeline.yaml
  signed-distance (node, python, gpytoolbox)
    references/hard-surface/measured-depth/sdf/compare.pipeline.yaml
```

## Scene projects

```text
Usage: stack3 project <verb> [project-file] [options]

  schema                                  List agent actions and field constraints as JSON
  components [component-id]               List built-in script components or inspect one
  init <file> [--name <name>]              Create a level project
  get <file>                              Read JSON hierarchy, settings, and current view state
  import <file> <atlas.png>...             Embed PNGs and add a scene object for each
      [--layout top,left,front,rear]       Direction order shared by inputs in this command
      [--parent <node-id>]                 Place the new objects under an existing node
  apply <file> <actions.json|->           Apply an atomic JSON action batch or read it from stdin
      [--revision <number>]                Require this revision before applying changes
  preset <file> four-wheel <root-id>       Attach WASD Vehicle and four Sprite Stack Wheel components
      [--wheels <fl,fr,rl,rr>]              Specify wheel IDs in front-left, front-right, rear-left, rear-right order
      [--revision <number>]                Require this revision before applying changes
  preset <file> tracked-tank <root-id>     Attach Tracked Drive, Turret Control, and both Track Belt components
  open <file> [--no-open] [--playground]   Open the live editor or interactive play view
  export <file> <node-id> --output <path>  Export one object's asset with its reconstruction settings
      [--format stack|glb]                 Overrides the object's output format
```
