# CLI

## Installation

With Node.js 22.12 or later, install the CLI from npm.

```sh
npm install -g stack3js
stack3 --version
```

The CLI is also available from [GitHub Releases](https://github.com/ev3rlit/stack3.js/releases).

## Commands

The command grammar is `stack3 <verb> <input> [options]`. Choose the output with `--format glb` or `--format stack`. A `.glb` output path also selects GLB automatically.

| Command | Purpose |
| --- | --- |
| `stack3 help [pipeline\|mesh\|capabilities]` | Show usage and supported commands. |
| `stack3 capabilities --json` | Inspect methods, guide fields, backends, pipeline nodes, schemas and bundled samples. |
| `stack3 example <name>` | Copy the bundled `future-tank` project or `traffic-cone` atlas. Use `--output` to choose a destination. |
| `stack3 inspect <input>` | Report mapped and missing directions, image dimensions, and input warnings. |
| `stack3 build <input> --output <file.glb>` | Reconstruct a mesh and write a GLB. |
| `stack3 build <input> --format stack --output <directory>` | Reconstruct a runtime stack and write its slice data and metadata. |
| `stack3 mesh <stack-directory> --output <file.glb>` | Reopen a saved stack and extract a surface from slice alpha (≥128). Use the default `marching-cubes`, another baseline (`surface-nets` or `voxel`), or a part-specific extractor. Run `stack3 mesh --help` for method names and `--guide <part.json>` inputs. Part-specific extractors use uv or a configured `STACK3_PYTHON`. See the [stack3 method and guide reference](https://github.com/ev3rlit/stack3.js/blob/main/skills/stack3/SKILL.md#choose-the-surface-method-per-part). Surface color comes from projections of the stored RGB. |
| `stack3 pipeline render <pipeline.yaml>` | Resolve includes and values into a validated, executable graph. |
| `stack3 pipeline run <pipeline.yaml>` | Execute the graph and write its GLB outputs. |
| `stack3 pipeline schema [recipe\|fragment]` | Print a standalone JSON Schema. Defaults to the root recipe schema. |
| `stack3 view <directory>` | Open an exported stack in Blender. Use `--output scene.blend` to keep a named scene, or add `--no-open` to that output for headless export. `--web` opens the web viewer; `--no-open` alone still prints its URL. |

For an atlas, supply its reading order with `--layout`.

```sh
stack3 inspect crate-4view.png --layout top,left,front,rear
stack3 build crate-6view.png --layout top,left,front,rear,right,bottom --output crate.glb
```

For individual images, pass a JSON manifest. Paths are relative to that manifest. Add `right` and `bottom` for a six-view set.

```json
{
  "views": {
    "top": "crate-top.png",
    "left": "crate-left.png",
    "front": "crate-front.png",
    "rear": "crate-rear.png"
  }
}
```

```sh
stack3 build crate-views.json --format stack --output crate-stack/
stack3 view crate-stack/ --output crate.blend
```

| Build option | Default | Effect |
| --- | --- | --- |
| `--texture-projection` | auto | For GLB output, use `top-contour` to project the TOP panel onto the upper surface while retaining elevation UVs on the walls |
| `--mesh-method` | marching-cubes | Choose `contour` for a plate extruded from the FRONT alpha outline |
| `--contour-hub` | off | Add a centered, turned hub to a contour mesh using TOP and LEFT |
| `--layers` | 128 | Vertical samples (integer ≥ 8 or `native`) |
| `--spacing` | 1 | Multiply the gap between stack slices and the exported vertical bounds |
| `--profile` | silhouette | Choose `round` or `round-base` to fit elliptical cross-sections |
| `--resolution` | 96 | Samples on the longer horizontal axis (integer ≥ 16 or `native`), or radial segments for a contour hub |
| `--height` | 1 | Asset height in scene units |
| `--pivot` | ground | Use the bottom or center as the origin |
| `--threshold` | 238 | Background removal threshold for opaque PNGs |

Contour extrusion preserves islands and through-holes. FRONT and REAR paint the caps and the other views paint the side walls. The plate uses the full depth unless a round hub is requested. For a hub, provide a solid center in FRONT, a thin blade edge with a projecting axle in TOP and a centered collar in LEFT. Vertical layer count applies to grid reconstruction.

`inspect` reports `nativeSamples` for X, Y, and Z from the fitted view images. For example, a taller elevation can supply detail above 128 layers. Use `--layers native` for the tallest fitted elevation and `--resolution native` for the pixel span on the longer horizontal axis (minimum 8 and 16 samples respectively). Numeric counts above the source detail are allowed and resample the images. Dense grids require memory proportional to width × depth × layers. Source PNG decoding separately checks 8,192 px per side and 16 MP per file. A generated stack sheet is checked against its manifest dimensions when reopened.

The stack bundle contains `stack.png` and `stack.json`. Its metadata records the atlas layout, slice order, dimensions, spacing, scale, and pivot.

Repeated builds reuse the local cache for matching input, format, and settings. Use `--no-cache` to bypass it or `STACK3_CACHE_DIR` to choose its location.

`view` and `project open` use the browser viewer bundled with the installed CLI. The preview server listens on loopback. Press Ctrl+C to close it.

[CLI requirements and completion check](https://github.com/ev3rlit/stack3.js/blob/main/docs/cli/README.md)

## YAML pipelines

Get supported backends and sample paths with `stack3 capabilities --json`. The bundled groups cover RGB atlas preview, mesh finishing with LOD and instancing, measured SDF, and Triple-Dexel. Copy a group to a writable workspace before creating outputs there.

Use the [pipeline JSON Schema](schema/pipeline.schema.json) for root and rendered recipes and the [fragment JSON Schema](schema/pipeline-fragment.schema.json) for files listed under `includes`. Both ship in the CLI package under `schema/`.

```sh
stack3 pipeline schema > pipeline.schema.json
stack3 pipeline schema fragment > pipeline-fragment.schema.json
```

With YAML Language Server, place this comment on the first line of the recipe and adjust the path to the schema.

```yaml
# yaml-language-server: $schema=./schema/pipeline.schema.json
```

The schema describes fields, types, ranges, node-specific options and supported value references. `pipeline render` also checks resolved values, node dependencies and output path collisions. Keys in a `-f` values file depend on the recipe, so the generic schema leaves its values mapping open.

Nodes refer to other nodes by ID. Put them all under `nodes` in one pipeline, or use `includes` for reusable fragments. Here `cab.pipeline.yaml` uses a saved stack for both preview and export.

```yaml
version: 1
includes: [surfaces.yaml]
values:
  stack: ./cab-stack
  output: ./dist
  precision: hermite-dc
nodes:
  - id: source
    type: load-stack
    path: '{{ .Values.stack }}'
```

`surfaces.yaml` contributes these nodes. `hermite-dc` uses the same Python environment as `stack3 mesh`.

```yaml
nodes:
  - { id: fast, type: extract-mesh, input: source, method: surface-nets }
  - { id: precise, type: extract-mesh, input: source, method: '{{ .Values.precision }}' }
  - { id: preview, type: write-glb, input: fast, path: '{{ .Values.output }}/preview.glb' }
  - { id: export, type: write-glb, input: precise, path: '{{ .Values.output }}/cab.glb' }
```

An optional `release.values.yaml` can set `output: ./release`. Multiple `-f` files override earlier values in order. Included defaults are applied before the including file's defaults. A quoted whole-field reference preserves the value's YAML type, so `layers: '{{ .Values.layers }}'` can resolve to an integer. References can also appear inside paths.

```sh
stack3 pipeline render cab.pipeline.yaml -f release.values.yaml > cab.resolved.yaml
stack3 pipeline run cab.resolved.yaml
```

Include paths are relative to the file declaring them. Node paths are relative to the root pipeline and become absolute in the rendered YAML, which can be run from another directory. `render` resolves and validates the graph without opening asset inputs or writing GLBs. `run` shares each node's result across its consumers. If a later node fails, outputs already written are kept.

To start from an atlas, use `type: reconstruct-stack` for `source`, set `path` to the PNG and `layout` to `top,left,front,rear`, or set `path` to a JSON view manifest. Optional fields are `layers`, `resolution`, `height`, `pivot`, `threshold`, and `profile`. Use `load-stack` to preserve edits to a saved stack. An `extract-mesh` node accepts the existing stack mesh methods and can take a `guide` path for part-specific methods.

### Hard-surface finishing

Add `finish` to an extraction node to fit and optimize a closed surface. Fitting groups connected faces by normal direction, then fits supported planes and optionally spheres or cylinders. Shared vertices are solved together along patch boundaries. Vertices outside those groups follow the extractor. Finishing checks winding, edge incidence, components and Euler characteristic before returning new geometry. A failed topology-changing operation logs the reason and retains the preceding mesh.

From a source checkout, run the [concrete barrier recipe](../../examples/hard-surface.pipeline.yaml) to generate a Surface Nets preview, a finished Hermite DC model, a lower-budget GLB, a Carrera comparison and a row of GPU instances.

```sh
npm run cli -- pipeline run examples/hard-surface.pipeline.yaml
```

```yaml
version: 1
values:
  stack: ./housing-stack
  bevel: 0.006
nodes:
  - { id: source, type: load-stack, path: '{{ .Values.stack }}' }
  - id: housing
    type: extract-mesh
    input: source
    method: hermite-dc
    cache: true
    finish:
      fitTolerance: 0.008
      primitives: true
      bevelWidth: '{{ .Values.bevel }}'
      bevelSegments: 2
      dissolveAngle: 0.5
      triangleBudget: 500
      aoRadius: 0.15
  - { id: model, type: write-glb, input: housing, path: ./out/housing.glb, lit: true }
  - { id: row, type: write-glb, input: housing, path: ./out/row.glb, lit: true, instances: [[0, 0, 0], [1.5, 0, 0]] }
  - { id: carrera, type: extract-mesh, input: source, method: signed-distance-dc }
  - { id: comparison, type: write-glb, input: carrera, path: ./out/signed-distance.glb }
```

- `fitTolerance`, `bevelWidth` and `aoRadius` use scene units. Blender runs headless for bevel, planar dissolve, quadric simplification and AO. Use `BLENDER_BIN` to choose an executable. Each LOD is a GLB from a branch with its own `triangleBudget` target. Re-import or measure thin features at each target budget.
- Texture projection uses the saved RGB and runs after topology changes. Creases split the area-weighted vertex normals. AO is written as vertex color (`COLOR_0`). `lit: true` selects a diffuse PBR material. `instances` writes `EXT_mesh_gpu_instancing` with per-instance translations in glTF XYZ coordinates.
- `cache: true` reuses processed geometry across runs using the stack, settings, guide and external field contents. Omit it when comparing different Blender or Python builds. Multiple outputs consuming one node share its in-memory result.

### Guided geometry regularization

Use `finish.regularization` to select measured features before optional bevel and QEM. The [regularization recipe](../../skills/stack3/references/hard-surface/finishing/regularize.pipeline.yaml) fits two planes, a bore wall and rim, and a polygonal pocket rim. It also optimizes a perpendicular relation. Regularization alone runs with the existing Python meshing environment.

Coordinates are pivot-relative stack XYZ scene units. The `tolerance` controls sample selection and fitting. Each `features` entry has a unique `id` and one of these types.

| Type | Fields | Operation |
| --- | --- | --- |
| `plane` | `bounds`, `normal` | Select a patch by its bounding box and normal hint, then fit an SVD plane. |
| `circle` | `center`, `axis`, `radius` | Select a rim from a center and radius hint. Fit its center and radius in the plane perpendicular to the supplied axis. |
| `cylinder` | `center`, `axis`, `radius`, `bounds` | Fit a center and radius for a bounded cylindrical wall with a fixed axis. |
| `polygon` | `corners` | Supply ordered XYZ corner hints. Fit supporting lines on the contour's plane and check that adjacent lines meet near the supplied corners. |

`bounds` contains minimum and maximum XYZ points. Optional `relations` entries use `type: parallel`, `perpendicular`, or `coplanar` and `features: [idA, idB]` to jointly refine two or more fitted planes. Relations are soft constraints backed by the sampled surface. A joint fit is rejected if its sample residual exceeds `tolerance`. Shared vertices are solved together. Moves longer than twice `tolerance` and moves incident to unsafe faces are discarded. Inspect the fitted and skipped feature IDs, solver diagnostics and actual mesh measurements after the run.

### Selective rim bevel for LODs

Set `finish.lodBevel` to run QEM before beveling selected circular rims. Supply `finish.triangleBudget` for the final cap and a smaller `lodBevel.preTriangleBudget` to leave room for bevel faces. `finish.bevelWidth` is required and `finish.bevelSegments` defaults to two.

Each `rims` entry supplies an `id`, `axis` (`x`, `y`, or `z`), `center`, `radius`, `radialTolerance`, and `axialTolerance`. Coordinates are pivot-relative stack XYZ scene units. The axis is perpendicular to the rim plane. The remaining center coordinates locate the circle. Both endpoints of a selected crease must lie within the tolerances. Rims run in recipe order. The pipeline fails if a rim has no matching creases, an operation breaks closed topology, or the result exceeds the final budget.

The [hard-surface benchmark](../../examples/hard-surface-benchmark/README.md) shows a verified configuration with Triple-Dexel, a 1,900-triangle pre-budget, and two selected rims within a 2,400-triangle final budget.

### Compare the two Dual Contouring methods

`hermite-dc` uses boundary crossings and estimated normals. `signed-distance-dc` uses Carrera et al.'s maintained [Gpytoolbox implementation](https://gpytoolbox.org/0.3.8/dual_contouring_of_signed_distance_data/). uv resolves Gpytoolbox 0.3.8 for that method. When using `STACK3_PYTHON`, install Gpytoolbox 0.3.8 in the selected environment.

```sh
stack3 mesh housing-stack/ --mesh-method hermite-dc --output hermite.glb
stack3 mesh housing-stack/ --mesh-method signed-distance-dc --output carrera.glb
```

For a matched-input comparison, pass `--guide field.json` to both methods. A guide like `{"field":"housing.npy"}` reads a finite floating-point array in XYZ order with shape `(width + 2, depth + 2, layers + 2)`. Samples sit at cell centers with one empty layer of padding. Distances are in scene units, negative inside, and their signs must match the saved stack. Without an external field, `signed-distance-dc` estimates distances from occupancy using physical axis spacing. Its guide accepts `outerIterations` and `innerIterations` from 1 to 100. The CLI defaults are 3 and 12 and use Gpytoolbox's automatically selected near-surface samples for repeatable local comparisons.

#### Registered triple-dexel input

An optional `{"dexel":"triple-dexel.npz"}` guide gives `hermite-dc` crossing locations and outward normals directly. The saved stack supplies the sampled occupancy and RGB. Use an NPZ with scalar `version: 1`, XYZ `grid`, `origin` and `step`, and these arrays for each axis `x`, `y` and `z`:

- `<axis>_offsets` indexes each ray in the packed arrays. The transverse coordinates are in XYZ order with the ray axis omitted, flattened in C order. Transverse rays pass through the other axes' cell centers.
- `<axis>_depth` contains strictly increasing enter/exit pairs on each ray. Rays point in the positive axis direction. Depth is measured from the stack grid's lower plane in scene units.
- `<axis>_normals` contains one outward XYZ unit vector per crossing.

All axes must classify the saved cell centers identically. A sign-changing grid edge must contain one crossing. The CLI reports additional crossings on edges without a sampled sign change. Use a finer grid to resolve thin features that fall entirely inside an edge. Supply either `dexel` or `field` in the guide.

## Scene projects

A scene project stores embedded PNG assets, a hierarchy of nodes, per-object reconstruction settings, camera and renderer settings, and a playback clock. A node can be a group, or an instance of an embedded atlas. Multiple nodes can share the source bytes and use different settings.

```sh
stack3 project init yard.stack3.json --name "Test Yard"
stack3 project import yard.stack3.json body.png wheel.png --layout top,left,front,rear
stack3 project get yard.stack3.json
stack3 project schema
stack3 project open yard.stack3.json
```

Use the IDs from `get` or `import` when building an action batch. An agent can create groups, instance an atlas, move nodes under a different parent, set per-object layer count or spacing, select nodes, and control the view and playback. The editor sees CLI changes automatically. Actions are atomic. Pass `--revision` when an edit depends on a specific project version.

```sh
stack3 project apply yard.stack3.json - <<'JSON'
[
  {"action":"node.add","id":"vehicle","name":"Vehicle"},
  {"action":"node.move","id":"BODY_NODE_ID","parentId":"vehicle"},
  {"action":"node.move","id":"WHEEL_NODE_ID","parentId":"vehicle"},
  {"action":"node.set","id":"BODY_NODE_ID","patch":{"settings":{"layers":72,"spacing":1.15,"resolution":128}}},
  {"action":"node.set","id":"vehicle","patch":{"angularVelocity":[0,35,0]}},
  {"action":"view.set","patch":{"backend":"gpu","selected":"vehicle"}},
  {"action":"view.frame"},
  {"action":"play.start"}
]
JSON
stack3 project open yard.stack3.json --playground
```

Use `project open --no-open` to print a JSON object containing the local URL. `project get` returns scene data without base64 images. `project import` accepts multiple paths per call. Use separate calls or `atlas.embed` with `node.add` when the layouts differ. `project export <file> <node-id> --output <path>` exports one atlas-backed node using its settings. Placement and hierarchy remain in the project file.

The project Playground plays the editable scene. Nodes support linear and angular motion, inherited through the hierarchy. Use `play.nudge` to move or rotate a node temporarily. In scenes with no enabled scripts, the movement buttons and WASD use that same action. Reset clears temporary offsets and script state while preserving authored transforms and component settings.

Use **Inspector → Rendering** in Editor or Playground to select a part and switch between **Sprite stack** and **Marching Cubes (3D mesh)**. Use **Viewport → CPU rendering** in that tab to compare **Detail Normals**, **Subpixel AA**, and **Specular AA** during playback. Detail Normals uses texture luminance to perturb the surface normal. Subpixel AA resolves four depth and coverage samples per pixel independently of Supersampling. Specular AA broadens highlights based on normal variation. For the two lighting options, enable **Material lighting** on the parts being compared. The three controls are also available to `view.set` as `detailNormals`, `subpixelAA`, and `specularAA` with `backend: "cpu"`.

### Script components

Use `stack3 project components` to list the built-in components as JSON, or `stack3 project components wasd-vehicle` and `stack3 project components sprite-stack-wheel` to read their JavaScript and inspector field defaults.

Once the wheels are atlas-backed direct children of a vehicle root, attach the driver and four wheel components atomically.

```sh
stack3 project preset cart.stack3.json four-wheel vehicle
stack3 project preset cart.stack3.json four-wheel vehicle --wheels fl,fr,rl,rr
```

Use the vehicle root's local −Z as forward and smaller X for its left side. The preset identifies wheels by name or shared atlas, or takes the four explicit node IDs in front-left, front-right, rear-left, rear-right order. It binds those IDs into the driver, derives initial wheelbase and radius from the scene, and prints the resulting assignments. Running it again keeps existing inspector values and authored poses. A conflicting customized component source returns an error before any changes are written.

For an assembled tank, run `stack3 project preset tank.stack3.json tracked-tank tank`. Place two atlas-backed Sprite stack tracks directly under the root, one on each side of local X, and name the tracks or their atlases with `track` or `tread`. Use a named `Turret pivot` child with the turret under it, or a direct turret node with its origin at the desired rotation center. The preset adds Tracked Drive, Turret Control, and two Track Belt components. Both presets are also in **Inspector → Presets** in Editor and Playground. In Play, WASD or the arrow keys drive the hull, and Q/E turn the turret. A stationary hull turn advances one belt and reverses the other. Belt rendering uses the original TOP atlas colors in both CPU and GPU Sprite stack previews.

Custom scripts can return `childTrackTravel` as a map from direct child ID to signed distance in the parent's movement units. The receiving track's script returns its `trackBelt` multiplier (−4 to 4). Reset clears playback-only belt offsets.

Select a node and use **Inspector → Script components → Add script**. Under **Edit script**, provide JavaScript defining `function update(input)` and an array of numeric inspector fields. Each field has `name`, `label`, `value`, `min`, `max`, and `step`. Save and enable the component, then press **Play** in the Playground. **Add WASD vehicle** inserts a complete driving script with adjustable speeds, steering, and wheel dimensions. That template expects forward along local −Z and uses child names containing “wheel” for roll; names starting with “Front” also steer.

```js
function update({ dt, keys, fields, state }) {
  const x = (state.x ?? 0) + (keys.includes('KeyD') ? fields.speed * dt : 0);
  return { state: { x }, translation: [x, 0, 0] };
}
```

For this example use `[{"name":"speed","label":"Speed","value":1,"min":0,"max":5,"step":0.1}]` for the field definitions.

Attach **Add Sprite Stack Wheel** to an atlas-backed child node to opt into wheel rendering. The parent script supplies that child's `childRotations` as roll around local X, steering around Y, and an optional tilt around Z. The wheel component returns `stackWheel: { rollScale, steeringScale }` (both from −4 to 4). In Sprite Stack mode the renderer applies roll by resampling the wheel volume onto horizontal slices and steers the whole wheel around its hub. In 3D mesh mode it rotates the mesh around the hub. The roll and steering multipliers can be set independently in the wheel inspector.

Each update receives elapsed seconds `dt`, the playback clock `time`, held physical key codes, current field values, the previous JSON `state`, the node’s authored `position` and `rotation`, and its direct `children` with IDs, names, and positions. Return absolute playback offsets relative to the authored pose in `translation` (XYZ units) and `rotation` (XYZ degrees), optional `childRotations` keyed by direct child ID (local XYZ degrees), and the JSON `state` for the next update. Scripts run only during live Play in each browser tab, inside a JavaScript VM with execution and memory limits. Pause freezes the preview, and Reset discards runtime state. Use **Viewport → Follow object** to track a scripted node with the camera.

The CLI can attach or edit a component with `script.set` (`nodeId`, `id`, and `patch`), detach it with `script.remove`, and select a camera target with `view.set` (`patch.follow`). See `project schema` for the full action shape.

For Blender preview, install Blender and put its executable on your PATH or set `BLENDER_BIN`. The standard macOS app location is detected automatically. The packed scene retains one textured quad per layer. With no output path the preview scene is written to a temporary directory.

## Verify orthographic artwork

`stack3 verify -f manifest.yaml` prints one JSON report. An atlas manifest measures projections and landmarks. An assembly manifest also follows the whole and part atlas paths. Its report contains `atlases.whole`, `atlases.parts` keyed by part name, and `results` with each part's mounting measurements. Each manifest supplies its own measurement tolerance. Add `--output-dir qa` to save the same JSON as report.json alongside the annotated overlays. Completed measurements exit zero. Invalid inputs exit nonzero. Read the pixel distances, unsupported sample counts and the applicable tolerance per run. Per-result status describes measurement availability. Run with uv or set STACK3_PYTHON to a Python environment with NumPy, Pillow, headless OpenCV and PyYAML. The verification script declares the tested versions.

**Atlas YAML.** Supply all four named views. Each has an image path, optional crop [left, top, width, height], origin [u,v] of the common coordinate system in the cropped panel, and a single positive scale in pixels per common unit. Image and manifest paths are relative to their containing YAML file. Pixel centers have integer coordinates. Positive image u points right and v down. Axis directions for (u,v) are TOP (+x,+y), LEFT (−y,−z), FRONT (+x,−z), REAR (−x,−z). The front points down in TOP and left in LEFT. Determine the registration from known common landmarks or scale evidence. Missing registration yields registration-needed. To segment an opaque white background, set mask to white (foreground requires alpha ≥128 and minimum RGB below threshold, default 238). For transparent images, use alpha (≥128).

Each boundary pixel supplies two coordinates. The remaining axis must have a common occupied interval in all other applicable silhouettes. Scanlines use pixel footprints, retain disconnected intervals and holes, and include the opposing elevation when present. A parallel view is checked at the corresponding pixel. tolerancePx defaults to 1. Disjoint-interval gaps use source-panel pixels; a scanline with no foreground has no finite interval gap and reports null. An unsupported parallel pixel has its own distance. Reports group consecutive unsupported samples along closed contour walks; sample counts refer to contour samples, not arc lengths. The overlay highlights these contours and illustrates one set of rays. Counts describe the sampled contours under the declared registration.

For landmarks supply entries with an id and a points map of view names to local [u,v] observations. A null observation marks an occlusion. Compare shared axes first, then use compatible pairs to predict an independently observed view. Shared-axis residuals are in the second input panel's pixels, and reprojection errors are in the held-out panel's pixels. The JSON records both.

**Assembly YAML.** Set whole to an atlas manifest and map parts by name. Each part supplies its atlas and mounts. Provide two or more distinct TOP pairs and at least one FRONT pair, each with part and whole pixel coordinates. TOP fits one positive uniform scale and planar translation, FRONT fits height. Frames must already share their physical orientation. Anchor residuals are recorded separately from checks. Each check names an id and view and supplies either a held-out part/whole point pair or a visible edge polyline in whole-panel pixels. The latter measures the maximum distance along that marked segment to the projected part outline. Set visible to false for hidden features. The reported transform remains fixed for every check.

See the [runnable locomotive example and measured outputs](../../samples/inspection/locomotive-verify/README.md).
