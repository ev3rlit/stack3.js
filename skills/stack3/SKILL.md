---
name: stack3
description: Generate four-view atlases, build sprite stacks or Marching Cubes meshes, compare lighting and anti-aliasing, and assemble and verify drivable vehicles with the stack3 CLI, Editor, and Playground. Use for stack3 atlas preparation, TOP or LEFT repair, reconstruction, and scene or component workflows.
---

# stack3 Sprite Stacks

Use visual-hull carving from Daniel White’s [Sprite Stacking workflow](https://github.com/danielwh2/sprite-stacking) to reconstruct horizontal RGBA slices. The output is a 2D sprite stack with bottom-to-top layers and pivot metadata.

## Generate the four views

Use this prompt for a new atlas. Substitute `[ASSET]` with the subject and its identifying features. Attach any source art as an identity and style reference. If the user specifies a style, add it explicitly. With source art, match its existing style. With neither, let the subject drive the look. Request pixel art only when the user wants it.

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
- Open and inspect TOP at native resolution before building. Require a vertical orthographic view along the height axis. Compare roof and base landmarks and footprint proportions with the other views. A visible vertical fascia, strip of front or side wall attributable to object height, or a roof-to-base shift indicates tilt. Horizontal ledges or sloped surfaces can legitimately appear in TOP.
- Use the replacement prompt for a missing or tilted TOP. For ambiguous cases or when an existing model is available, use [Orthographic source preparation](references/orthographic-views.md). CLI dimension warnings can identify scale inconsistencies. They cannot establish camera orientation.
- Inspect LEFT at native resolution for a visible front face, a visible flat top, or separation between landmarks that should coincide across the width. Compare their longitudinal positions with TOP and their heights with FRONT and REAR. For a symmetric silhouette, record which orientation cues can actually be confirmed.
- Use separate aligned inputs and pivots for independently moving parts. A cavity hidden in every silhouette is ambiguous even when the views pass the camera checks.

## Build and open the sprite stack

For a level, hierarchy, interactive preview, or multi-object workflow, create or reuse a scene project. Use the CLI from the agent workflow instead of asking the user to operate browser controls. Invoke the image tool with the prompts above when images are missing, inspect TOP, then embed the PNGs as project objects. Read `stack3 project schema` and `stack3 project get <file>`, apply a JSON action batch with `stack3 project apply <file> -`, and open the live view with `stack3 project open <file> --playground`. Use concrete node IDs in each batch, keep object settings per node, and verify the resulting scene.

Prefer an installed `stack3` CLI that supports these verbs. Verify capabilities with `stack3 --help`. In a stack3.js checkout with dependencies installed, use `npm run cli --` in place of `stack3`. Pass absolute paths when invoking from the checkout for assets elsewhere.

```sh
stack3 inspect asset-4view.png --layout top,left,front,rear
stack3 build asset-4view.png --layout top,left,front,rear --format stack --output asset-stack/
stack3 view asset-stack/
```

A separate-view manifest uses `{"views":{"top":"top.png","left":"left.png","front":"front.png","rear":"rear.png"}}`. Paths are relative to the manifest. Pass it to `inspect` and `build` without `--layout`.

If `view` is unavailable, launch the checkout viewer with `npm run viewer -- --open`, import the same source, and select **Sprite stack**. Use the same layer count, XY resolution, threshold, height, and pivot. If the viewer or checkout is unavailable, report which verification could be completed.

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
- Consider an additional split when the assembled views hide the contour needed to recover an intended gap, separate overlapping forms, or give painted relief its depth. Fine texture on an otherwise convincing shape can stay painted.
- Recommend the smallest split that would expose the missing contour. Cite the observed symptom, the angle where it appears, and which view of the isolated part would describe it. For example, if a bridge frame masks the walking deck's rise, a separate LEFT elevation of the deck reveals its crown. If the current result reads clearly, keep the assembly. Honor requests for a single atlas, specified parts or independent motion. When asked for a review, stop at recommendations.
- After rebuilding, repeat the same camera comparison and test the feature that prompted it. For a bridge, measure the deck at the landings and center and check clearance through both frames.
- **Pixel art** enables nearest sampling. Leave it off unless requested. **Smooth edges** and **Grid** are independent preview controls. Switching these controls leaves the reconstructed layers and exported PNG unchanged.
- Layer count, XY resolution, threshold, height, and pivot rebuild from the source. Revisit a previous combination with the same source to verify a session cache hit. Orbit, zoom, and preview filters reuse the current result.
- Report the bundle path, layer count, dimensions, pivot, and preview checks you actually completed.
