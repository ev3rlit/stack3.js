# Hard-surface benchmark with selective rim bevels

Use [lod-bevel.pipeline.yaml](lod-bevel.pipeline.yaml) with the bundled benchmark stack and Triple-Dexel data. Copy the hard-surface reference folder to a writable location to keep recipe, guide and input paths together.

```sh
stack3 pipeline render lod-bevel.pipeline.yaml > resolved.yaml
stack3 pipeline run resolved.yaml
```

Run these commands in the copied `case-studies/benchmark` directory. Check `stack3 capabilities --json` for `benchmark-beveled-lod`. If the installed CLI lacks it, run `npm run cli -- pipeline …` from the source checkout with the copied recipe's absolute path. Hermite DC and regularization use the Python meshing backend. The LOD operation uses Blender and honors `BLENDER_BIN`.

## Settings that passed

1. Use measured Hermite crossings and normals from the bundled Triple-Dexel fixture. Its authored design has five upper protrusions and five front openings.
2. Use `regularization.tolerance: 0.006` in pivot-relative stack scene units.
3. Reserve geometry for beveling with `lodBevel.preTriangleBudget: 1900`.
4. Bevel the front through-bore rim and the cylindrical-post top rim with `bevelWidth: 0.0025` and `bevelSegments: 2`. These offsets correspond to 0.15 mm at the benchmark scale. The recipe declares each center, axis, radius and selection tolerance in scene units.
5. Verify the final `triangleBudget: 2400` and the feature geometry.

The verified GLB uses **2,356 triangles**. It retains five raised regions, one through-hole and four blind pockets. The four pocket center depths are about 10, 14, 15 and 12 mm. The opening IoUs range from 0.9834 to 1.0. The Blender check found zero open edges, non-manifold edges, inconsistent edges or zero-area triangles.

Use the same settings for this fixture. For another asset, reselect the rims and verify width, topology and feature measurements after QEM. The final triangle cap is enforced after beveling. Lower the pre-budget if the selected bevels require additional room.
