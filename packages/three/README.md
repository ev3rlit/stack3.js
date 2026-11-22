# Three.js Adapter

This package will turn core results into scene objects. A mesh result provides geometry and materials. A stack result provides its ordered layers and the information needed to project them consistently in the scene.

Both paths will honor the same dimensions and pivot. The adapter will own GPU resources and expose a way to release them when a model is replaced.

[Runtime and Three.js requirements](../../docs/runtime/README.md)
