---
name: stack3
description: Turn a subject or reference image into a four-view atlas, a saved sprite stack, and a 3D mesh. Use for stack3 CLI discovery, YAML pipelines and schemas, hard-surface fitting and LODs, measured SDF or Triple-Dexel geometry, Blender review, and Editor or Playground workflows.
---

# stack3 Sprite Stacks

## Start from the input

**Subject or reference image → image-generated atlas PNG → saved RGBA sprite stack → 3D surface mesh → Blender review and finishing.** Use this order for single objects and assemblies. Choose the part boundaries in 2D before creating any geometry.

| Input for this task | First action |
| --- | --- |
| Description, photo, sketch, or uncalibrated render | Invoke the host's image generation tool with the [four-view prompt](#generate-the-four-views). Attach the supplied images as identity references. Generate and save one PNG per chosen part, then inspect it. A reference photo still requires this step. |
| Existing orthographic atlas or individually mapped views | Inspect the supplied TOP, LEFT, FRONT, and REAR. Retain accepted views and generate any missing or rejected panels using the repair prompts below. |
| Saved sprite stack | Validate and reuse its PNG and manifest. For a mesh request, proceed directly to surface extraction. |
| Existing 3D asset designated by the user as the source | When orthographic images are needed, use Blender early to isolate parts and render calibrated views of that asset. Save those PNGs and continue at atlas inspection. |

Use early Blender work for a concrete upstream dependency, such as checking scale and camera axes on a supplied scene, or checking registration of existing views. Identify the input and the check or image it supplies, then resume the sequence. A request for a Blender deliverable specifies the destination. Do not build a proxy, model the subject, or select an incidental workspace mesh to manufacture the first atlas from a description or photo. If image generation is unavailable, use an available authorized image provider or request the missing four-view inputs. Keep any completed inputs.

## Reconstruction and handoff

Use visual-hull carving from Daniel White’s [Sprite Stacking workflow](https://github.com/danielwh2/sprite-stacking) to write `stack.png` and `stack.json`. For a mesh, reopen the saved bundle (including any edited slices) and extract its surface. Keep the atlas, bundle and mesh paths together per part so the result can be traced back to its images. Stop at the requested stage for atlas-only or sprite-only work.

Use **Blender** by default to view and verify the stack or mesh, assemble named parts at their mounts, and do retopology, materials, lighting and other post-processing. For an editable Blender delivery, pack textures, save a new `.blend`, and reopen it for review. Use Editor/Playground for web-specific controls, physics or CPU/WebGL comparisons.

## Discover and run hard-surface pipelines

Read the installed CLI's capabilities before writing a recipe. Its JSON lists supported method names, guide fields, pipeline nodes, backends and bundled sample paths.

```sh
stack3 help pipeline
stack3 capabilities --json
stack3 pipeline schema > pipeline.schema.json
stack3 pipeline schema fragment > pipeline-fragment.schema.json
```

From the repository checkout, use `npm run cli --` in place of `stack3`. Discovery, schema export, and YAML rendering run in Node. Check each mesh extraction and finishing backend in the capabilities response before running the graph.

Use the [grouped hard-surface recipes](references/hard-surface/README.md) for RGB atlas reconstruction, saved-stack finishing and LOD, measured SDF, and Triple-Dexel. The folder includes runnable inputs and both editor schemas. Copy it to a writable directory before running a recipe. Use the root schema for the pipeline and the fragment schema for files listed under `includes`. Render the recipe to review its resolved method, guide, options, and output paths. Run the resolved YAML to create the GLBs.

| Technique | Entry point and evidence |
| --- | --- |
| Voxel reconstruction | `reconstruct-stack` uses atlas silhouettes for occupancy. `load-stack` imports existing layers and any edited cavities. Both run in Node. |
| SDF and normal estimation | `hermite-dc` estimates crossings and normals from occupancy or aligned `guide.field` SDF samples. `signed-distance-dc` runs Carrera DC with estimated or supplied distances. Both use Python. |
| Dual Contouring and QEF | `hermite-dc` fits mesh vertices to surface crossing planes. `guide.dexel` supplies registered Triple-Dexel crossing positions and outward normals. Leave ambiguous cells to a method such as `mc33` after inspecting what the recovered volume contains. |
| Geometric feature segmentation and plane fitting | `finish.fitTolerance` groups adjacent faces by normal direction and fits planes with SVD in physical coordinates. |
| Primitive fitting and boundary stitching | `finish.primitives: true` with `fitTolerance` also tries sphere and cylinder fits. Shared boundary vertices are solved together across fitted patches. Both fitting passes use Python. |
| Procedural bevel | `finish.bevelWidth` and `bevelSegments` use Blender edge bevel on eligible creases. |
| Planar dissolve, QEM, and LOD | `finish.dissolveAngle` and `triangleBudget` invoke Blender. Put each triangle budget on a separate extraction branch to export each LOD. |
| Material reconstruction | Extraction projects the saved stack RGB. Hard-surface Python extraction builds crease-aware area-weighted normals. `finish.aoRadius` uses Blender rays to bake vertex AO. |
| Runtime packaging | `write-glb` exports in Node. Use `lit` for a lit material, `instances` for GPU instance translations, and `extract-mesh.cache` to reuse processed geometry. |

Inspect the run diagnostics and the exported geometry. A requested stage can retain the preceding mesh when its fitted or edited result fails checks. For a benchmark, keep the input stack and optional measured guide together, use the same grid and camera for each method, and measure apertures, thin spans, and actual triangle counts after export.

## Choose the atlas boundaries first

For assemblies, use **one four-view atlas per distinct part → one sprite stack per atlas → part-specific cross-sections where needed → meshes with local pivots → assembly**. Keep a whole-object reference for scale, mounts, and final silhouette comparison.

- Split where a part moves independently or another part hides an outline needed to reconstruct it. A wheel needs its axle pivot; an arch that hides the deck profile calls for an isolated deck atlas. Keep paint, panel lines, and shallow relief on the material. Let the intended screen size guide how much detail to model.
- Make the split in the **input images**. Depict each detached part in TOP, LEFT, FRONT, and REAR, including its inferred mounting face. Cutting up a finished whole-object mesh does not supply those missing views. Reuse one source for identical instances; check handed shapes and markings before mirroring.
- For a simple continuous object, or an explicit single-atlas request, use one atlas and follow the build steps below. For a multipart build, follow the [part atlas and assembly workflow](references/part-atlases.md).

## Generate the four views

Use this prompt once per chosen atlas. Substitute `[ASSET]` with the whole subject or the detached part and its identifying features. For a part, state which neighboring pieces to omit and which side meets the assembly. Attach any source art as an identity and style reference. If the user specifies a style, add it explicitly. With source art, match its existing style. With neither, let the subject drive the look. Request pixel art only when the user wants it.

Fill in the LEFT landmark lines with observable parts from this asset. For a handcart, the handles project toward screen-left and the two hubs on one axle coincide. For a lamp with an arm extending right in FRONT, look along the arm in LEFT; a post in front of it occludes it wherever they overlap. Omit an inapplicable cue for a symmetric object such as a plain barrel.

```text
Create one wide PNG production atlas of [ASSET] as four orthographic views of one fixed object. Use the attached references for identity and appearance when supplied. Keep the same pose, parts, proportions, asymmetries, materials, colors, markings, and surface detail in every panel. Preserve the reference's rendering style, gradients, and edge treatment.

Arrange exactly four panels in one horizontal row, in this order: TOP, LEFT, FRONT, REAR. Use transparent or uniform light backgrounds and generous blank gutters between silhouettes. Leave the full object and its footprint uncropped in every panel. Keep one common scale in pixels per unit. Omit labels, frames, grids, props, and cast shadows.

TOP — True orthographic plan. Put the camera directly over the object with its optical axis vertical and pointed straight down, perpendicular to the ground plane. Use a 90° depression angle with zero roll. The object's front points toward the bottom of the image. Place the silhouette using the full footprint, including any base or horizontal ledges that extend beyond the top surfaces. Landmarks on the same vertical line project to the same image point, regardless of height. Vertical edges have zero projected length, and vertical wall faces appear edge-on. Show the upper-facing and sloped surfaces visible on this axis. Exclude any tilted overhead, isometric, three-quarter, or perspective framing.

LEFT — True orthographic left elevation. Place the camera directly to the object's left, looking horizontally across its width, with zero yaw offset, pitch, and roll relative to that side view. The front points screen-left, the rear screen-right, and vertical edges remain vertical. Show the full length and height.

Project the entire width onto this plane. Two landmarks at the same front-to-rear position and height project to the same point even if they are on opposite sides. The nearer surface hides the farther one wherever they overlap. Flat front and rear faces perpendicular to the length appear edge-on. A horizontal top face has zero projected area. Show sloped and curved surfaces visible from this axis.

Place [FRONT LANDMARK] toward screen-left and [REAR LANDMARK] toward screen-right. Seen along the width axis, [WIDTH-ALIGNED FEATURE] appears [EXPECTED END PROFILE OR OCCLUSION].

FRONT — Horizontal orthographic elevation looking directly at the front. REAR — Horizontal orthographic elevation looking directly at the rear. Use level cameras and the same ground line across these three panels.

Match TOP length to LEFT length and TOP width to FRONT and REAR width. Match LEFT, FRONT, and REAR heights. Keep the same identifiable part geometry and placement across all views.
```

## Replace a tilted TOP

If the other elevations are usable, attach them as references and generate only the TOP. Fill in `[LANDMARKS]` with a concrete footprint and at least one height-independent alignment cue when available, such as a roof corner directly above a base corner. Keep the accepted images intact. Match the replacement to their scale with a uniform resize only if needed. If matching length and width requires different scaling on each axis, review the TOP again before assembling the atlas.

```text
Generate a single PNG showing the TOP of [ASSET]. The attached LEFT, FRONT, and REAR elevations describe the exact object. Preserve its identity, pose, materials, marks, source style, and asymmetries. Use these footprint and alignment cues: [LANDMARKS].

Render a strict orthographic plan with the camera directly above the object's center. The optical axis is parallel to the vertical axis, aimed straight down at 90° to the ground plane. The front points toward the bottom of the image. Align upper and lower landmarks that share a vertical line to the same image position. Vertical sidewalls appear edge-on. No visible strip of a vertical front or side face, no perspective convergence, and no oblique or isometric camera. Keep outward ledges, overhangs, and sloped surfaces where a real plan view would show them.

Match the full footprint length implied by LEFT and width implied by FRONT and REAR. Include the entire footprint with a clear margin. Return one centered view on a transparent or uniform light background, without text, cast shadows, or additional panels.
```

## Replace an incorrect LEFT

When LEFT fails a side-view landmark check, attach the accepted TOP plan and FRONT and REAR elevations as references and generate one panel. Fill in the error and its geometric correction from the rejected attempt. For example, if both cart wheels are visible side by side, specify that their hubs share one axle and must coincide in LEFT.

```text
Generate one replacement LEFT elevation of [ASSET]. The attached TOP, FRONT, and REAR describe the exact object. Preserve its parts, proportions, asymmetries, materials, and rendering style.

Correct this observed error in the previous LEFT: [OBSERVED ERROR]. From the exact left-side camera, [LANDMARK] must appear [EXPECTED POSITION, OVERLAP, OR EDGE PROFILE] because [GEOMETRIC REASON].

Look horizontally across the object's width in orthographic projection. The front points screen-left. Match the full front-to-rear length measured in TOP and the height and ground line of FRONT and REAR at one common scale. Return only LEFT, uncropped with a clear margin, on a transparent or uniform light background without text or cast shadows.
```

Inspect the replacement at native resolution against the stated landmark and dimensions. Fit it with a uniform resize and translation if needed. If the overlap or proportions still fail, use that specific discrepancy in the next attempt. Keep the accepted panels and original files intact.

## Prepare and verify the views

- Preserve the source style, colors, gradients, shading, and antialiased detail. Keep the input PNGs untouched. Use pixel-art generation, palette reduction, dithering, or nearest-neighbor preview only when requested. Preview sampling and a baked pixel-art style are separate choices.
- Accept an explicitly mapped atlas or separate PNGs. Use `top,left,front,rear`, optionally with both `right,bottom`. Set the front down in TOP and left in LEFT. Keep the same object, pose, scale, ground line in elevation views, and clear silhouette separation. Transparent backgrounds are preferable for light subjects.
- For a registered four-view atlas, run `stack3 verify -f part.atlas.yaml --output-dir qa/part` before building. Supply the original panel crops, pixel origins and one scale per panel; add independently marked landmarks when visible. For an assembly, pass its manifest to the same command to include both whole/part atlas measurements and mount residuals in one JSON report. Review unsupported contour runs, held-out residuals and skipped or unregistered views in report.json alongside the PNG overlays.
- Open and inspect TOP at native resolution before building. Require a vertical orthographic view along the height axis. Compare roof and base landmarks and footprint proportions with the other views. A visible vertical fascia, strip of front or side wall attributable to object height, or a roof-to-base shift indicates tilt. Horizontal ledges or sloped surfaces can legitimately appear in TOP.
- Use the replacement prompt for a missing or tilted TOP. For ambiguous views or a user-designated source model, use [Orthographic source preparation](references/orthographic-views.md). CLI dimension warnings can identify scale inconsistencies. They cannot establish camera orientation.
- Inspect LEFT at native resolution for a visible front face, a visible flat top, or separation between landmarks that should coincide across the width. Compare their longitudinal positions with TOP and their heights with FRONT and REAR. For a symmetric silhouette, record which orientation cues can actually be confirmed.
- A cavity hidden in every silhouette is ambiguous even when the views pass the camera checks. Record any inferred depth or hidden profile used to reconstruct it.

## Optional detail passes

Read only the prompt needed for the user's request.

| Request | Prompt |
| --- | --- |
| Clay, depth, or more definition in physical features such as bevels, recesses, or gaps | [Clay and Depth](prompts/clay-depth.md) |
| Base Color, normals, or more definition in paint, material response, or shallow surface relief | [Base Color and Normal](prompts/base-color-normal.md) |
| Both geometry and surface detail | [Clay and Depth](prompts/clay-depth.md), then [Base Color and Normal](prompts/base-color-normal.md) using the accepted geometry and cameras |

For a standard 4-view request, use [Generate the four views](#generate-the-four-views). For any additional passes, keep a common canvas, camera calibration, and foreground alignment.

## Build and open the sprite stack

New grid builds default to **128 layers**. Use `stack3 inspect` to read `nativeSamples` along X, Y, and Z from the fitted images. Use `--layers native` to sample the tallest fitted elevation when its rows matter. Choose higher layer counts for taller sources and higher XY resolution for finer footprints when useful. Sampling above the observed pixel counts reuses image data. Size each part for the intended view and available memory. Use pixel-art or voxel styling when explicitly requested and honor any specified sample counts.

Choose slice orientation by output and camera:

- **Sprite stack, fixed or overhead camera:** start with horizontal sheets stacked by height. Check the lowest intended camera angle, where gaps between sheets become visible.
- **Sprite stack, multiple camera angles:** add a vertical set facing the missing view. A longitudinal sheet presents a face to a side camera; a transverse sheet presents a face to a front camera. For free rotation, try horizontal plus both vertical sets and check exact top, front, and side views. Two vertical sets are both edge-on from directly above, even at high density.
- **Final mesh:** choose section guides per part from the view that reveals its shape or thickness. Reslicing the same occupancy along more axes adds no independent shape evidence. The stock CLI writes horizontal stacks; crossed sheets require custom axis-specific bundles and oriented instances sharing the same world scale and pivot. When comparing layouts, report sheets per axis and compare at the intended screen size with a stated total sheet or texel budget.

For a stack3 Editor or Playground request, create or reuse a scene project. Use the CLI from the agent workflow instead of asking the user to operate browser controls. Embed the accepted atlas PNGs from the input stage as project objects. Read `stack3 project schema` and `stack3 project get <file>`, apply a JSON action batch with `stack3 project apply <file> -`, and open the live view with `stack3 project open <file> --playground`. Use concrete node IDs in each batch, keep object settings per node, and verify the resulting scene.

Prefer an installed `stack3` CLI that supports these verbs. Verify capabilities with `stack3 --help`. In a stack3.js checkout with dependencies installed, use `npm run cli --` in place of `stack3`. Pass absolute paths when invoking from the checkout for assets elsewhere.

```sh
stack3 inspect asset-4view.png --layout top,left,front,rear
stack3 build asset-4view.png --layout top,left,front,rear --format stack --output asset-stack/
stack3 mesh asset-stack/ --output asset.glb
```

A separate-view manifest uses `{"views":{"top":"top.png","left":"left.png","front":"front.png","rear":"rear.png"}}`. Paths are relative to the manifest. Pass it to `inspect` and `build` without `--layout`.

For a surface delivery, import `asset.glb` into Blender, verify its geometry and bounds, then finish the scene. For a slice preview, run `stack3 view asset-stack/ --output asset-slices.blend`. The default view opens a fresh Blender process with a packed scene of horizontal, alpha-masked quads. Use `--output asset.blend --no-open` for headless delivery. Use `--web` for the browser viewer or `--no-open` alone for its URL. If an older CLI lacks Blender support, import the stack or part meshes with Blender Python.

## Choose the surface method per part

Keep the saved stack as the common geometry input. Choose a method based on what the part must preserve, even when different parts belong to the same assembly.

Run `stack3 mesh PART_STACK --mesh-method METHOD --output PART.glb`. Add `--guide PART.json` for the fields below. If a saved bundle exists, reuse it directly. The three base methods run in Node. The part-specific methods use [uv](https://docs.astral.sh/uv/) to cache a Python 3.11–3.13 environment on first use. For an already provisioned or offline environment, set `STACK3_PYTHON` to its interpreter and install `numpy==2.2.6 scipy==1.15.3 scikit-image==0.25.2 shapely==2.1.2`. Add `gpytoolbox==0.3.8` for `signed-distance-dc`.

| Part or goal | CLI method | Guide and inspection |
| --- | --- | --- |
| General baseline | `marching-cubes` (default), `surface-nets`, `voxel` | No guide. Check thin tips, smooth shells and exact cell bounds respectively. |
| Thin plate with matching sections | `section-loft` | Optional `{"axis":"x"}`. Linearly join aligned loops. Check root, middle and end. |
| One continuous thickness interval per column | `heightfield` | Optional `{"axis":"z"}` selects thickness direction. Read the reported count of filled multi-interval columns. |
| Rounded shell | `smooth-loft` | Optional `{"axis":"y"}`. Shape-preserving cubic interpolation between matched rings. Check input and intermediate sections. |
| Axisymmetric body | `revolve` | Requires `axis` and `origin`. Optional integer `segments` (8–512, default 64). Check symmetry, poles and the inner meridian. |
| Housing with creases | `extended-mc`, `hermite-dc` | Use estimated crossing information, or supply `field` or `dexel` to `hermite-dc`. Inspect crease placement and cells with conflicting sheets. |
| Registered signed distances | `signed-distance-dc` | Optional `field`, `outerIterations` and `innerIterations`. Compare with `hermite-dc` using the same aligned SDF. |
| Through-hole or ambiguous saddle | `mc33` | No guide. Lewiner MC33 at 0.5 on the padded binary samples. Recheck the entire passage. |
| Creating, splitting or merging loops | `branch-loft` | Optional `{"axis":"z"}`. Read overlap events. Regions must overlap in adjacent sections to belong to the same branch. |
| Swept handle or pipe | `path-sweep` | Requires `path`. The first stack section supplies the outer and hole loops. Optional `up` and `profile` (`outer`, optional `holes`) override the initial frame and profile. Use an open path, check curvature and the lumen. |
| Independent intersecting cuts | `section-network` | Requires `sections` with measured curves and registered planes. Optional positive `tolerance` in scene units. Inspect the reported re-cut errors. |
| Textured block surfaces | `greedy`, `monotone` | No guide. Compare against `voxel`. Check texture boundaries, holes, sealed seams and final GLB vertex/triangle counts. |

**Guide coordinates.** Use local stack XYZ in scene units relative to the saved pivot, with Z up and +Y forward. The cell grid starts at `[-sizeX/2-pivotX, -sizeY/2-pivotY, -pivotZ]`. Z spacing comes from `stack.json`. An omitted section/thickness axis is Z. In a rotation guide, the axis is parallel to X, Y or Z through the supplied point. The sampled positive meridian is +Y, +Z or +X respectively. Example for a bottle around Z:

```json
{"axis":"z","origin":[0,0,0],"segments":64}
```

For either section loft, all occupied slices are controls by default. Optional `stations` selects sparse controls by zero-based slice index. The first and last occupied slices are always included. A station can also supply a replacement `outer` and optional `holes` for a single component. Coordinates are local scene units in YZ for axis X, ZX for Y, and XY for Z. For example, `{"axis":"z","stations":[{"slice":2},{"slice":6,"outer":[[-0.2,-0.1],[0.2,-0.1],[0.2,0.1],[-0.2,0.1]]}]}` uses a saved contour at slice 2 and a supplied contour at slice 6. Inspect the output at these stations and halfway between them.

A sweep profile uses 2D scene units. Its first basis vector is `up` projected perpendicular to the first tangent (defaults to the least-aligned Cartesian axis). The second is tangent × first. The frame is parallel-transported along the path. Supply outer and hole loops without repeating the endpoint. Adapt dimensions and path to the saved part:

```json
{"path":[[0,0,0.1],[0,0,0.5],[0.2,0,0.8]],"up":[0,1,0],
 "profile":{"outer":[[-0.05,-0.05],[0.05,-0.05],[0.05,0.05],[-0.05,0.05]],
            "holes":[[[-0.02,-0.02],[-0.02,0.02],[0.02,0.02],[0.02,-0.02]]]}}
```

For a section network, `origin + u*s + v*t` registers each 2D point `[s,t]` in local XYZ. Supply orthonormal `u,v` and closed polygons (`outer`, optional `holes`). Set `source` to `independent` only for actual independent cuts. Projection silhouettes and cuts resampled from the same stack cannot supply this evidence. The following horizontal and vertical cuts agree on their common line:

```json
{"sections":[
  {"source":"independent","origin":[0,0,0.5],"u":[1,0,0],"v":[0,1,0],
   "outer":[[-0.4,-0.3],[0.4,-0.3],[0.4,0.3],[-0.4,0.3]]},
  {"source":"independent","origin":[0,0,0],"u":[1,0,0],"v":[0,0,1],
   "outer":[[-0.4,0.1],[0.4,0.1],[0.4,0.9],[-0.4,0.9]]}]}
```

Record the stack, method, guide, stderr diagnostics and target camera per part. Reopen the GLBs in Blender to inspect size, orientation, pivots, textures and seams, assemble at mounts and make local edits. Apply QEM after extraction when a triangle budget calls for it, then measure the simplified result again.

## Explicit contour extrusion

Use this alternate atlas-to-mesh route when contour extrusion is requested. The default surface workflow for thin parts still uses the saved stack. For a flat sign, fin or rotor, use `stack3 build atlas.png --layout top,left,front,rear --mesh-method contour --output part.glb`. FRONT defines the outline, including disconnected islands and holes; LEFT determines overall depth. Select **Contour extrusion** in the viewer's mesh settings or the project inspector. Project nodes use `format: "glb"` and `meshMethod: "contour"`.

For a rotor with a solid center and a visibly projecting axle, add `--contour-hub` or set `contourHub: true`. TOP gives the blade thickness and LEFT gives the collar diameter. `--resolution` controls the number of segments around the hub. Inspect both end faces, the side wall and the axle after assembly.

## Prepare a drivable four-wheel vehicle

After importing and placing the chassis and four wheels, run the four-wheel preset before opening Playground. Place the wheels as atlas-backed direct children of the vehicle root. Use local −Z for forward and smaller local X for the left side. The preset attaches WASD Vehicle to the root, binds the exact four wheel IDs, and attaches Sprite Stack Wheel to all four in one edit. The wheel components keep the slices horizontal while the wheels roll.

```sh
stack3 project components
stack3 project components sprite-stack-wheel
stack3 project preset /absolute/path/cart.stack3.json four-wheel vehicle
stack3 project get /absolute/path/cart.stack3.json
stack3 project open /absolute/path/cart.stack3.json --playground
```

If the preset cannot identify the wheels, get their IDs from `project get` and pass `--wheels <fl,fr,rl,rr>` in front-left, front-right, rear-left, rear-right order. Inspect the preset's returned mapping and confirm one driver and four wheel components in the saved project. During Play, verify forward movement, front-only steering, and visibility through a full wheel turn. Use the preset for driver and wheel attachment so later runs can preserve existing component values.

## Prepare a tracked tank

Import the hull, turret, and track atlases. Instance the same track on each side of local X and keep both tracks as direct Sprite stack children of the tank root. Name the two tracks or their atlas with `track` or `tread`. Place a named turret pivot under the tank root and put the turret atlas instance under that pivot. For a demo conversion, use the source dimensions and pivot from the demo.

Run `stack3 project preset /absolute/path/tank.stack3.json tracked-tank tank` once after assembly. The preset attaches Tracked Drive, Turret Control and two Track Belt components. Inspect the mapping with `project get` and use Playground to verify WASD translation, A/D pivot turns with opposite belt travel, Q/E independent turret motion, and Reset. Editor and Playground expose the same preset under the selected root's **Inspector → Presets**.

## Compare rendering in Editor or Playground

Open **Inspector → Rendering**. Choose the atlas-backed **Part** to edit even when a group is selected in the hierarchy. **Asset type → Marching Cubes (3D mesh)** uses the mesh path (`settings.format: "glb"`). **Sprite stack** uses horizontal slices (`"stack"`). Multi-view texturing is automatic in both modes. The mesh projects a selected atlas view per triangle; the stack combines compatible colors from multiple views.

**Material lighting** is per part. **Smooth edges** and **Pixel art** are sprite-stack controls. **Supersampling** is a viewport control on both backends. Under **CPU rendering**, compare **Detail Normals**, **Subpixel AA**, and **Specular AA** separately. Detail Normals and Specular AA require Material lighting on the part under review.

For agent-driven comparison, use `node.set` with `patch.settings.format` or `patch.settings.lighting` and `view.set` with `patch.backend: "cpu"` and the relevant flag (`detailNormals`, `subpixelAA`, `specularAA`, or `supersampling`). Read `project schema` and `project get`, then keep the pose and camera fixed while changing one setting per capture. Keep tracked belts in Sprite stack mode when verifying their animation.

## Validate the live result

- Start with the requested asset or part list. Review an existing reconstruction when available. For CLI output, reopen the exported bundle when supported. Orbit a full turn at the intended viewing scale. Check landmarks, thin parts, seams, footprint, scale and ground contact, then compare a revealing diagonal and side view with the source PNGs.
- When geometry leans or a marking appears on the wrong face, keep the revealing camera angle and trace the same landmark through the mapped TOP, LEFT, FRONT and REAR. Fix a swapped panel assignment directly. If a source drawing contradicts the other views, regenerate just that drawing, rebuild, and compare from the saved angle. If the views agree and only the paint is misplaced, inspect face-to-view texture projection and UVs.
- Recommend the smallest split that would expose the missing contour. Cite the observed symptom, the angle where it appears, and which view of the isolated part would describe it. For example, if a bridge frame masks the walking deck's rise, a separate LEFT elevation of the deck reveals its crown. If the current result reads clearly, keep the assembly. Honor requests for a single atlas, specified parts or independent motion. When asked for a review, stop at recommendations.
- After rebuilding, repeat the same camera comparison and test the feature that prompted it. For a bridge, measure the deck at the landings and center and check clearance through both frames.
- **Pixel art** enables nearest sampling. Leave it off unless requested. **Smooth edges** and **Grid** are independent preview controls. Switching these controls leaves the reconstructed layers and exported PNG unchanged.
- Layer count, XY resolution, threshold, height, and pivot rebuild from the source. Revisit a previous combination with the same source to verify a session cache hit. Orbit, zoom, and preview filters reuse the current result.
- Report the bundle path, layer count, dimensions, pivot, and preview checks you actually completed.
