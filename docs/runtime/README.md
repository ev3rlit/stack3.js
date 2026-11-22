# Runtime and Three.js

The runtime builds a ready-to-render asset from images or loads one that has already been baked. Both mesh and stack are valid runtime choices.

## Required Behavior

- Run browser reconstruction in a Worker and report progress while the interface stays responsive.
- Apply the latest result when settings change during reconstruction. Replace or release GPU resources when an asset is superseded.
- Cache reconstructed data by source views, reconstruction settings, target, and format version. Reuse the matching result on reload when the environment supports persistent storage.
- Turn mesh buffers into a Three.js object and stack layers into a renderable sprite-stack object. Keep their pivots and dimensions consistent.
- Reuse the reconstructed asset across multiple scene instances. Position and rotation updates should reuse the underlying geometry and textures.

The core operates on decoded data. Browser and Node adapters own file access, image decoding, scheduling, and persistence. The Three.js adapter owns the scene representation.

## Completion Check

Display a runtime mesh and stack directly after import. Open the same project again and verify cache reuse. Rotate multiple instances and verify that their geometry or slice data is reused.
