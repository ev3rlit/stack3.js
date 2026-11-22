# Reconstruction

The TypeScript core converts a normalized view set into a volume and derives the selected output. The browser and CLI use the same reconstruction code.

## Required Behavior

- Build occupancy from aligned silhouettes and retain the source colors for reprojection.
- Control vertical sampling with the layer count and horizontal sampling with XY resolution. Keep object dimensions stable when sampling density changes.
- Generate horizontal slices for the stack target and an indexed surface with normals for the mesh target. Marching Cubes is the initial surface extraction method from the demo.
- Respect direction when choosing surface colors. With six views, use the right and bottom inputs when those faces are visible.
- Keep silhouette and texture decisions inspectable. Provide an adjustable silhouette threshold and show which view contributed color when diagnosing artifacts.

Silhouettes can leave closed cavities and curved transitions ambiguous. A loader bucket is a useful test case for deciding which shape corrections the workflow needs.

## Completion Check

Reconstruct the same cone as a mesh and a stack. Verify matching bounds and pivots at two sampling densities, valid nonempty geometry, and a ground contact point that stays fixed when the layer count changes.
