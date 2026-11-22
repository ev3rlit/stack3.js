# Viewer

Run `npm run viewer` from the repository root. Pick a sample asset, or choose a PNG atlas or named individual views. Atlas layouts are assigned in reading order. The viewer supports four and six directions.

The viewer starts in **Sprite stack** mode with linear sampling and smooth edges. **Pixel art** switches to nearest sampling, **Smooth edges** toggles stack edge coverage, and **Grid** toggles the ground reference. **CPU** software rasterization and **GPU** WebGL rendering both support stacks and meshes. These switches affect presentation. Reconstruction runs in a shared TypeScript worker.

The worker rebuilds when the asset type, layer count, resolution, threshold, asset height, or pivot changes. Larger builds show a lower-resolution preview first. Results are reused from the session or IndexedDB. Orbit, zoom, spacing, and rendering options reuse the current result. Stack exports include the selected spacing. **Open GLB** reopens a file with embedded resources for inspection.

The **Traffic Cone** preset uses **Round above square base**. This preserves its square foot and rounds the tapered body using the width and depth observed in the elevations.

The vehicle presets assemble independent atlases. The Rover and Inspection Robot use a body and a reusable wheel. Ant Mech uses a body and two leg atlas types. Armored Miniature uses a hull, turret, and track. **Add part atlases** accepts multiple PNGs for a custom assembly with editable positions and scales. A GLB export retains named part nodes. A stack export bakes the placed parts into a single stack atlas.

Use `npm run cli -- view <directory>` to open the `stack.png` and `stack.json` produced by the CLI. Reconstruction controls apply after loading source views.

Interactive crop and alignment editing and project save/load are on the feature plan.

## 4-view comparison

Open **4-view comparison** from the Asset viewer or a local project. Choose a project part, a built-in Armored tank atlas, or one PNG in TOP, LEFT, FRONT, REAR order. The gallery shows the seven mesh stages and a Sprite Stack thumbnail in a three-column layout on desktop. Orbit, elevation, and zoom are shared by all thumbnails. Clay hides the textures of the mesh stages.

**Future Tank · hull material passes** compares the silhouette-only and depth-carved meshes on the same grid. Depth Fit reports mean absolute depth error against the supplied atlas on shared visible pixels. The color and normal cards use the same depth-carved mesh and lights. [Sample inputs](../../samples/future-tank/README.md#hull-material-passes)

**Armored tank · full (assembled)** reconstructs the hull, turret, and track atlases independently at every stage and uses the Armored Miniature preset mounts to assemble them. Source proportion warnings are shown per part.

For a scene with multiple visible atlas nodes, **Project · full (assembled)** uses the authored hierarchy and transforms.

The stages are exposed voxel faces, Marching Cubes on the same coarse grid, a finer Marching Cubes grid, RGB projection with nearest texture sampling, RGB projection with linear texture sampling, inferred IDs, and depth regularization. Each thumbnail reports its grid size and triangle or slice count. **Layers** rebuilds the previews during input. **Spacing** moves the Sprite Stack slices immediately and retains their textures. **Explode** temporarily separates mounted parts across all previews. Set it to 0% to return to the assembled pose.

The ID preview uses RGB heuristics for amber and cyan accents and first-hit depth checks for texture visibility. Small front lights use a separate front-facing color layer, hidden in Clay mode. The depth preview also regularizes the silhouette volume before extracting the surface and normals. This smooths visible steps but cannot recover geometry hidden from the source views.

## Playground

Open **Demo yard** for Cargo Rover, Inspection Robot, Ant Mech, and Armored Miniature. Drive vehicles, add or remove prop PNGs, and change heading, sun direction, time of day, shadows, and CPU outlines. The yard preserves the original drive controls, prop layouts, rendering technique toggles, and performance readout. The [standalone demo app](../demo/README.md) uses the runtime from the [Sprite Stacking Demo snapshot](https://github.com/ev3rlit/sprite-stacking-demo/tree/8b8bb05554404537fc59cb030aeb6851b5c00ba0) with separate stack/mesh selection and a GPU slice renderer.

## Scene editor and project Playground

Open a saved project with `stack3 project open <file>`. This editor operates on the same project as `stack3 project apply`. Use the hierarchy to select or reparent objects, and the inspector to set transforms, motion, and reconstruction settings per object. **Import PNGs** embeds one or more atlases and adds nodes beneath the selection. **Instance** reuses an embedded atlas. The project Playground is a play view of that same level, with play, pause, step, and reset. [Project CLI](../cli/README.md#scene-projects)

[Viewer requirements](../../docs/viewer/README.md)

Select **3D mesh → Mesh method → Contour extrusion** for a flat part. FRONT defines its outline and holes, and LEFT sets the overall depth. Enable **Centered round hub** for a rotor with a projecting axle. The project inspector exposes the same options under **Asset type**.

For a mesh, choose **Texture projection → Upper contour from TOP** to paint the upper surface from the plan view. **Automatic (multi-view)** uses the usual per-face selection. This setting works with either mesh method and is saved on project nodes.
