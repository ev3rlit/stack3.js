# Feature Plan

The first workflow is to turn an aligned multi-view image set into either an interactive 3D mesh or a sprite stack. Both results should be usable in a running application and exportable for later use. These documents describe planned work.

For the implemented pipeline, follow the roof of a Petite Town house from its four-view PNG through reconstruction, export and browser assembly. [Atlas-to-runtime walkthrough](atlas-to-runtime.md)

## Feature Areas

| Area | Responsibility |
| --- | --- |
| [Inputs and alignment](inputs/README.md) | Import 4 or 6 views and normalize direction, silhouette, and scale |
| [Reconstruction](reconstruction/README.md) | Build a volume and derive mesh or sprite-stack data |
| [Outputs and baking](outputs/README.md) | Export portable GLB and runtime stack bundles with matching dimensions and pivots |
| [Runtime and Three.js](runtime/README.md) | Reconstruct asynchronously, cache results, and display either target |
| [CLI](cli/README.md) | Inspect input and build both targets with verb-first commands |
| [Viewer](viewer/README.md) | Align inputs, tune an asset interactively, and verify the export |
| [Web app](web/README.md) | Publish docs and host a playground that uses the viewer |
| [Agent skill](skill/README.md) | Guide image preparation, validation, and conversion |
| [Validation](validation/README.md) | Verify input parity, runtime behavior, and export round trips |

## Build Order

1. **Agree on one input and result contract.** Run the same traffic cone through atlas import and individual image import. Compare the normalized views and reconstruction.
2. **Close one end-to-end path.** Get both a runtime stack and a mesh into the viewer, then build both from the CLI using the same settings. Reopen the exported GLB and stack bundle.
3. **Exercise six views and runtime reuse.** Use a model with a distinct right side and bottom. Check that the extra views improve the intended surfaces. Verify that a cached result can be rendered without rebuilding it.
4. **Make the workflow usable by others.** Document the actual commands, publish a browser example, and write the agent skill against the tested workflow.

## Decisions to Verify During Implementation

- Define scene-unit conversion and the pivot default using a real test asset.
- Choose the smallest stack bundle format that preserves layer dimensions, order, spacing, and optional color data.
- Verify how best to bake projected colors onto a mesh so the GLB and the live preview agree.
