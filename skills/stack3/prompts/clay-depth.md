# Clay and Depth Passes

## Input

Use the approved model or the approved 4-view atlas of `[ASSET]`. Keep any independent parts isolated and use the same pose in every pass. Record one set of orthographic cameras and a common scale. For a 2D source, first complete the four-view image atlas and sprite-stack reconstruction. Use the reconstructed surface for the paired Clay and Depth renders and label its depth as estimated.

## Prompt

Use this prompt to prepare a Clay reference when the input is 2D. With approved 3D geometry, render the Clay pass directly.

```text
Create a Clay 4-view atlas of [ASSET] using [APPROVED REFERENCE] for geometry and placement.

Match the reference canvas, scale, framing, pose, and parts. Arrange the four orthographic views in one row in TOP, LEFT, FRONT, REAR order. Point the front down in TOP and screen-left in LEFT. Keep a common ground line across the elevations.

Use neutral matte gray and soft lighting. Preserve physical bevels, recesses, joints, openings, and clearance gaps. Use a transparent or uniform light background with clear gutters. Exclude paint, markings, emission, labels, and cast shadows.
```

## Output

- **Clay PNG** — render untextured geometry from the four calibrated cameras.
- **Depth PNG** — write the first visible surface distance along each camera ray as 16-bit grayscale. Use `0` for the background and `1–65535` for linear inverse depth, with brighter values closer to the camera.
- **Calibration** — record atlas dimensions, scene size, pixels per scene unit, and each view’s rectangle, pixel anchor, camera origin and axes, and near and far distances. Decode a valid texel as `near + (far - near) * (65535 - value) / 65534`. Record the geometry source and whether the depth is estimated.

## Verification

Confirm the Clay foreground matches the valid depth pixels in each view. Check the same silhouette landmarks in both passes and spot-check the distance on a raised feature and a recessed surface. If comparing or importing the maps, verify the available tooling supports the chosen encoding. Compare depth on and off using the same Clay, grid, camera, and lighting.
