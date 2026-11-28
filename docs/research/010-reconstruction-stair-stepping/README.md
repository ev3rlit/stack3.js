# 010 · Reconstruction stair-stepping

Where does stair-stepping enter the image → sprite stack → mesh pipeline, and how can reconstruction reduce it while preserving slopes, curves, corners, and thin features?

| ID | Experiment | Status |
| --- | --- | --- |
| 010.010 | [Resolution baseline](010.010-resolution-baseline/README.md) | Measured |
| 010.020 | [XY versus layer resolution](010.020-xy-vs-layer-resolution/README.md) | Measured |
| 010.030 | [Feature preservation](010.030-feature-preservation/README.md) | Measured |
| 010.040 | [Corner constraints and local refinement](010.040-corner-constraints-and-local-refinement/README.md) | Measured |
| 010.050 | [Slot width, direction, phase, and visibility](010.050-slot-sweep/README.md) | Measured |

## Findings and candidates

- **010.010 · Resolution baseline.** The largest increase in wedge height and cylinder radius error occurred at voxel sampling. Higher resolution reduced final mesh RMS error by 49% and 42%, respectively. It recovered full coverage on the measured thin-plate section, with local thickness still varying. The denser grid used about 6.7× as many cells. The higher-resolution preset remains an experimental setting.
- **010.020 · XY versus layer resolution.** Layers alone reduced wedge mesh RMS by 34% and brought the sampled plate section to 100% coverage. XY alone captured the full measured cylinder improvement of 42%. Both increases gave the lowest wedge error and raised the plate's minimum sampled thickness from 0.53% to 0.67% of asset width relative to layers alone.
- **010.030 · Feature preservation.** At XY 96 / 96 layers, a silhouette distance field with refined edge crossings reduced slope, radius, and thickness RMS by about 95–96%. It improved the wider slot's width estimate, increased error at the wedge's upper corner, and left the narrower slot closed. The prototype is available in the experiment directory.
- **010.040 · Corner constraints and local refinement.** At the same grid budget as 010.030, a fitted ridge constraint recovered the wedge's upper corner on the measured section. Reallocating one X plane recovered the narrow through-slot and restored all three connected components.
- **010.050 · Slot limits.** Across 64 conditions at equal budget, X-plane redistribution restored four exposed depth-direction slots. It left diagonal and partly obscured cases identical to the uniform field. At 45°, a visible 1.60% slot was continuous, while about a quarter of the same slot stayed blocked under a TOP occluder.
- **Follow-up candidates.** Use gap evidence from multiple calibrated views and refine along the detected slot direction. Test fitted ridges on profiles that change with depth and measure preprocessing and extraction costs.
