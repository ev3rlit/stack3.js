# Outputs and Baking

Both outputs carry a scale, bounds, and a pivot. Choose the target by how the asset will be rendered and reused.

| Target | Runtime result | File output |
| --- | --- | --- |
| Mesh | Indexed geometry, normals, and color or texture data | One GLB with mesh and baked appearance |
| Sprite stack | Ordered horizontal layers and stack metadata | A bundle with slice images and metadata |

## Mesh Baking

- Convert the live projected color into portable vertex colors or UV textures. Check the result in the viewer before calling the export ready.
- Keep asset scale, pivot, orientation, and material in the saved model. Store camera zoom and preview lighting separately.
- Reopen the GLB and compare silhouette, dimensions, pivot, and color in the same lighting setup.

## Stack Baking

- Preserve slice order from bottom to top, slice dimensions, layer count and spacing, scale, bounds, and pivot.
- Store enough atlas or slice addressing information for the runtime to find each layer.
- Reopen the bundle and render it at the same orientation and scale used for its live preview.

## Completion Check

Export both targets for one source asset and reopen them. Compare with the live result at front, side, and oblique angles, and verify that a game can load either output with the same placement.
