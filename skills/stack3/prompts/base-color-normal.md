# Base Color and Normal Passes

## Input

Use the approved painted reference and the accepted Clay atlas or mesh for `[ASSET]`, together with its camera calibration. If Clay and Depth already exist, reuse their geometry, view rectangles, and cameras. For an independently moving part, prepare its own pair of passes.

## Prompt

Use this prompt to generate a Base Color reference. Project or register it to the approved geometry before delivering the atlas.

```text
Create a Base Color atlas of [ASSET] from [APPROVED PAINTED REFERENCE],
registered to [APPROVED CLAY ATLAS OR MODEL].

Keep the same canvas, cameras, scale, crop, silhouettes, and part
positions. Keep the TOP, LEFT, FRONT, REAR order. Align panel
boundaries and other landmarks to the Clay geometry in each view.

Preserve the paint, material colors, panel lines, labels on the object,
and markings. Use surface color with restrained variation. Exclude
baked lighting, cast shadows, and glare. Keep face-specific details,
such as lamps, in the views that can see their actual mounting face.
```

## Output

- **Base Color PNG** — save the registered color atlas in sRGB with the Clay foreground mask. If a face-specific marking needs separate projection, keep it in a decal with the corresponding face and placement.
- **Normal PNG** — render or bake the visible surface directions from the same geometry and cameras. Store linear view-space RGB with image-right in red, image-up in green, and toward-camera in blue. Encode each component as `round(127.5 * (component + 1))` and use the Clay foreground mask. When a detailed model supplies shallow grooves or bevels, bake them into this pass. For a final UV-mapped model, bake the result into the mesh's tangent space.

## Verification

Overlay the passes with Clay and inspect silhouettes, part boundaries, and landmarks. Check that normal axes match the camera calibration and that the image is read as linear data. When preview tools support the maps, compare Base Color with and without normals on the same mesh, at the same angle and lighting.
