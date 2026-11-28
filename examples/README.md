# Standalone examples

Build the Demo Yard as a single HTML file from the repository root.

```sh
npm run build:demo
```

Open `examples/demo-yard.html` in a browser. It contains the embedded vehicles, props, and runtime, so you can move the file to another folder and open it offline. The regular `npm run build` also generates this file.

[One-line launch commands for macOS and Windows](../README.md#play-the-demo-yard) · [Demo controls](../apps/demo/README.md)

## Hard-surface benchmark

[Run the benchmark](hard-surface-benchmark/README.md) to compare a Triple-Dexel Hermite DC mesh with a selectively beveled LOD under the same camera. The example includes the YAML recipe, reference images, final GLB and an independent Blender geometry check.

## Furniture Showroom

[Open the Furniture Showroom project](furniture-showroom/README.md) to compare nine original furniture models with their Stack3 reconstructions in Three.js and ThreeRT.
