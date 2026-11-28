# Chick surface smoothing

All variants use the saved chick stack in the parent directory, the same physical scale, cubic interpolation, Hermite DC and smooth normals. The baseline GLB is the previous experiment's hermite-dc.glb. Run the YAML recipe with the stack3 pipeline runner to regenerate the four other meshes. No part decomposition or adaptive remeshing was used.

| Variant | Gaussian sigma in minimum voxel pitches | Taubin iterations | QEM budget |
| --- | ---: | ---: | ---: |
| baseline | 0.8 | 0 | — |
| sigma125 | 1.25 | 0 | — |
| sigma155 | 1.55 | 0 | — |
| taubin | 1.25 | 6 | — |
| finished | 1.25 | 6 | 1600 |

The MP4 compares baseline and finished over 120 poses, 3 degrees apart. The large renders show neutral clay and the small renders show projected stack RGB. Both use the same orthographic camera, pose, lights and center of rotation. Blender import QA is in mesh-qa.json.

The silhouette IoU in metrics.json uses the registered masks of the generated four-view atlas, with the same projection and rasterization as the parent benchmark. mean_iou averages the four views with equal weights. ground_z is the lowest vertex, relative to nominal ground at zero for a unit-height source.

For torso_radial_residual_rms, intersect triangles with horizontal planes at heights 24/128 through 88/128, spaced by 1/128. Measure the outermost radius from the stack center at every 5 degrees. For each radius from heights 28/128 through 84/128, subtract the mean radius one stack layer (1/32) above and below. Report the RMS of those residuals in scene units. This samples small changes in the torso profile, including intentional curvature. It is a comparison metric for this asset.
