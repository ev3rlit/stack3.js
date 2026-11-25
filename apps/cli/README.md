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
| `stack3 example <name>` | Copy the bundled `future-tank` project or `traffic-cone` atlas. Use `--output` to choose a destination. |
| `stack3 inspect <input>` | Report mapped and missing directions, image dimensions, and input warnings. |
| `stack3 build <input> --output <file.glb>` | Reconstruct a mesh and write a GLB. |
| `stack3 build <input> --format stack --output <directory>` | Reconstruct a runtime stack and write its slice data and metadata. |
| `stack3 view <directory>` | Open an exported stack in the local viewer. Add `--no-open` to print the URL without opening a tab. |

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
stack3 view crate-stack/
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
