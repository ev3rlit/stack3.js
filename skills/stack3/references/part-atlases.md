# Part atlases and assembly

## Register the inputs

Keep the whole-object TOP, LEFT, FRONT, and REAR as an assembly reference when available. Mark a few shared landmarks such as the axle center, door sill, or roof ridge. For each unique part, record its atlas, physical or relative dimensions, local pivot, and mount transform in that frame. A tight image crop loses the original position, and separately generated atlases often have different drawing scales.

For descriptions and photos, use the [four-view image prompt](../SKILL.md#generate-the-four-views) to generate four isolated views of each part before reconstruction. Use a supplied valid part atlas directly. For a cart, the body atlas shows the body with the wheels removed; the wheel atlas shows both end profiles and the tread. One wheel stack can supply multiple mounts. If an asymmetric side or a marking changes across a pair, provide the corresponding view or a distinct atlas. The project editor accepts positive scale; use mirrored input views if a reflected instance is needed there. Verify front/rear orientation after mirroring.

## Build the part and guide its sections

Run the normal inspect/build sequence on each unique input. For example, with a wheel atlas and its actual height in scene units:

```sh
stack3 inspect wheel.png --layout top,left,front,rear
stack3 build wheel.png --layout top,left,front,rear --format stack --height 0.6 --output wheel-stack/
```

Compare a slice through a recognizable landmark with the reference. When the hull is too boxy, take widths from TOP and heights from an elevation at matching stations. Use a rounded section for a curved housing, a dome with a flat base for a cover, or measured upper and lower edges for a thin plate. Keep the simple hull wherever its sections already fit. For a visible recess, trace the rim and guide only the cells to remove. Treat an unseen floor depth as an estimate.

For a mesh derived from a sprite stack, save the adjusted RGBA layers with their spacing, size, and pivot. Reopen `stack.json` and `stack.png`, unpack the bottom-to-top tiles using the recorded column count, and extract the surface from their alpha occupancy. Apply the part dimensions and pivot when converting grid coordinates to mesh coordinates. Choose a [surface method per part](../SKILL.md#choose-the-surface-method-per-part). After any section edits are saved, run `stack3 mesh wheel-stack/ --output wheel.glb` on the final bundle. Direct atlas-to-GLB builds are a separate CLI path and bypass saved slice edits. The built-in `--profile` choices cover simple profiles. Asset-specific station curves and subtractive masks belong in the reconstruction code.

## Assemble and verify

Place each part at its recorded mount. Check the attachment in the assembled pose and inspect normally hidden faces in an exploded pose. For a moving part, rotate it about its local pivot, then return it to the recorded pose and check the fit again.

Overlay assembled TOP, LEFT, FRONT, and REAR renders on the whole-object views at a shared scale and registration. Keep the camera fixed across versions. A matching isolated wheel with a shifted axle calls for a mount correction; a wrong rim profile in the isolated atlas calls for a source correction. For thin parts, compare upper/lower surface intersections at the same landmark before and after refinement.

When reporting quality, show the input atlas sheet and an assembled capture; add a separated view when it explains the split. If measuring error, report silhouette IoU (intersection divided by union) per available view and identify its reference. Generated views measure consistency with the drawings. A calibrated source photo adds a likeness check; 3D accuracy needs a known 3D reference. Splitting can improve editability while reducing whole-object silhouette agreement, so check both. For small on-screen assets, compare at the intended pixel width before retaining extra geometry for fine detail.
