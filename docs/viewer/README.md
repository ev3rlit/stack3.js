# Viewer

The viewer is the asset editing and validation interface, built around the shared reconstruction core and Three.js adapter.

## Required Behavior

- Import an atlas or individual images and show each assigned direction.
- Let users correct the crop, mask, orientation, scale alignment, and ground line before reconstruction.
- Preview stack and mesh from the same camera. Show the effects of layer count, XY resolution, and silhouette threshold.
- Separate preview controls such as orbit, zoom, and lighting from asset controls such as scale, pivot, ground contact, and slice spacing.
- Save the source view references and settings so the CLI can reproduce the asset. Export either target and open the resulting file or bundle for review.

## Completion Check

Import a cone, adjust its pivot without changing the camera, and change the camera zoom without changing the exported dimensions. Save the project and reproduce the result through the CLI.
