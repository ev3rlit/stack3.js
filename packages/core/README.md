# Core Reconstruction

This package will accept decoded and aligned orthographic views plus reconstruction settings. It will handle silhouette reconstruction and return typed geometry or sprite-layer data.

| Target | Runtime data |
| --- | --- |
| Mesh | Positions, indices, normals, material or texture data, bounds, and pivot |
| Stack | Ordered horizontal layers, layer dimensions and spacing, bounds, and pivot |

Both targets use the same axis convention, scale, and origin. Changing layer count resamples the same physical height. Changing scale changes the asset dimensions. The CLI and browser adapters will handle files, image decoding, caching, and progress events.

[Inputs](../../docs/inputs/README.md) · [Reconstruction](../../docs/reconstruction/README.md) · [Outputs](../../docs/outputs/README.md)
