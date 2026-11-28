# Hard-surface recipes

## Discover features and run a recipe

```sh
stack3 help pipeline
stack3 capabilities --json
stack3 pipeline schema > pipeline.schema.json
stack3 pipeline schema fragment > pipeline-fragment.schema.json
```

The capabilities response lists available recipe paths and the backend each recipe needs. Copy the `hard-surface` directory to a writable workspace to keep inputs, includes, and editor schema hints together. Run the commands below from the copied `finishing` directory.

```sh
stack3 pipeline render finish-lod.pipeline.yaml > resolved.yaml
stack3 pipeline run resolved.yaml
```

`render` resolves values and checks dependencies without opening the geometry inputs. `run` creates outputs. Node paths are relative to the root recipe. Include paths are relative to the file declaring them. For overrides, pass `-f settings.yaml`. Later values files take precedence. Use the `recipe` schema for a root or resolved recipe and `fragment` for included files.

## Sample groups

| Group | Recipe | Result and requirements |
| --- | --- | --- |
| **RGB atlas** | [atlas/preview.pipeline.yaml](atlas/preview.pipeline.yaml) | Node visual-hull occupancy, Surface Nets, and a GLB preview of the bundled concrete barrier. Start here for a Node-only run. |
| **Hard-surface finishing** | [finishing/finish-lod.pipeline.yaml](finishing/finish-lod.pipeline.yaml) | Saved housing stack → Hermite DC and QEF → plane and primitive fitting → Blender bevel, planar dissolve and vertex AO. Exports detail, a lower-budget LOD, and three GPU instances of the LOD. Uses uv or `STACK3_PYTHON` and Blender, discoverable through `BLENDER_BIN`. |
| **Guided regularization** | [finishing/regularize.pipeline.yaml](finishing/regularize.pipeline.yaml) | Fit front and side planes, a cylindrical bore and its circular rim, and a square pocket rim. Jointly refine the perpendicular relation between the planes. Uses uv or `STACK3_PYTHON`. |
| **Benchmark case with selected rim bevels** | [case-studies/benchmark/README.md](case-studies/benchmark/README.md) | Run QEM first, then bevel the through-bore and cylindrical-post rims. Includes the tested YAML and geometry measurements. Uses uv or `STACK3_PYTHON` and Blender. |
| **Measured SDF** | [measured-depth/sdf/compare.pipeline.yaml](measured-depth/sdf/compare.pipeline.yaml) | Feed the same registered 3D signed-distance grid to Hermite DC and Carrera DC. The bundled rotated box has an analytic SDF and recorded reference dimensions. Carrera uses Gpytoolbox 0.3.8. |
| **Triple-Dexel** | [measured-depth/triple-dexel/compare.pipeline.yaml](measured-depth/triple-dexel/compare.pipeline.yaml) | Compare MC33 from saved occupancy with Hermite DC using registered X/Y/Z crossings and outward normals. The prepared benchmark includes five openings and five upper protrusions. Its fixture records authored hole depths and through-hole assumptions. Uses uv or `STACK3_PYTHON`. |

Applied finishing stages print diagnostics. Check for a retained preceding stage when fit, bevel, dissolve, or QEM would compromise the surface. Check actual triangles against the LOD target. Review thin regions, openings, disconnected components, pivot, textures, and normal seams in the exported GLB.

## Guides and representation

- The [recipe schema](schema/pipeline.schema.json) describes pipeline nodes, method names, input paths, and finish settings. The [fragment schema](schema/pipeline-fragment.schema.json) references the recipe schema beside it. CLI schema exports are standalone JSON.
- Hermite DC accepts a guide with either `field` or `dexel`. An SDF `.npy` has XYZ shape `(width + 2, depth + 2, layers + 2)`, one empty cell of padding and signed scene-unit distances with negative values inside. A Triple-Dexel `.npz` has scalar `version: 1`, XYZ `grid`, `origin`, `step`, and `<axis>_offsets`, `<axis>_depth`, `<axis>_normals` for each axis. Rays point in the positive axis direction. Store depths from the lower grid plane and flatten transverse ray coordinates in XYZ order with that axis omitted. Depth pairs are ordered, with one outward XYZ unit normal per crossing. The occupancy must match the saved stack at cell centers. Guide paths are relative to their guide JSON.
- A 4-view RGB atlas supplies appearance and silhouettes. When depth or occluded geometry is required, use registered measurements or a fixture with explicitly authored geometry. The measured samples bundle their inputs so they run without a separate fixture generator.
- GLB export uses projected color from saved stack RGB. The finishing sample generates area-weighted shading normals and vertex AO in `COLOR_0`. A `write-glb` node's `instances` are translations in glTF XYZ units.
- Guided feature hints use pivot-relative stack XYZ scene units. Start with a small tolerance and just the features that can be located independently. Check final aperture sizes, through-hole continuity and pocket depths when applying a fit or a plane relation.
