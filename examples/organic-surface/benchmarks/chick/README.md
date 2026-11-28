# Chick · whole-character extractor comparison

The rightmost chick in the supplied four-animal reference provided the character design. ImageGen inferred the other viewpoints. The camera poses and hidden surfaces have no measured 3D ground truth.

## Rebuild

From this directory in the stack3.js checkout:

```sh
node ../../../../apps/cli/bin/stack3.mjs build chick-4view.png --layout top,left,front,rear --resolution 32 --layers 32 --height 1 --profile round --format stack --output stack
node ../../../../apps/cli/bin/stack3.mjs pipeline run compare.pipeline.yaml
```

The first command samples a single 32 × 31 × 32 RGBA stack. The round carving profile clips each horizontal section to an ellipse. The second command loads the saved stack once and branches into the two organic extractors. Both use a Gaussian sigma of 0.8 times the smallest voxel pitch, cubic interpolation, smooth normals and projected stack RGB. Mesh smoothing, adaptive remeshing, retopology and triangle reduction are disabled.

## Review

The MP4 shows 120 rendered poses at 3-degree intervals at 24 fps. The camera is orthographic, about 8 degrees above horizontal. Blender Workbench uses identical lighting, framing and pivot for both columns. The upper row shows projected RGB. The lower row uses a single neutral material. Frame 0 is the front view. The GIF is a downsampled looping preview.

The per-view silhouette IoU in measurements.json compares the projected GLB triangles to the four fitted input alpha masks using the stack coordinate frame. Triangles were rasterized at 2× the fitted image dimensions and averaged down before thresholding at 50%. The turntable IoU compares the two rendered alpha masks at each of the 120 poses. Blender's per-mesh checks were run after GLB import with UV seam vertices merged. Ground heights use a reference character height of 1 scene unit. These are silhouette and topology checks; texture fidelity is assessed from the color renders.

## Atlas generation

Built-in ImageGen, one source image, one four-view PNG. Original prompt:

Use the supplied reference showing four farm animals. Make a technical four-view color atlas depicting ONLY the small yellow baby chick at the far right, one whole bird per panel. Four separate orthographic renders of exactly the same single intact chick in a single wide horizontal row with generous clear gutters between the silhouettes. Left to right: true TOP plan (directly overhead, face/front toward page bottom, mainly crown, wings and tip of beak; feet hidden by body); true LEFT side elevation (beak points screen left, one visible eye); straight FRONT elevation (symmetrical face, two visible eyes and both feet); straight REAR elevation (no eyes or beak visible, wings and two feet visible). Each panel shows the whole character fully uncropped. Match the reference chick: squat plump pear/egg-shaped sunny yellow toy bird, two small yellow rounded feathers on its crown, chocolate oval eyes with small highlights, short orange two-piece beak with mouth line, two little rounded attached paddle wings, two short orange legs with plump toe pads. Preserve shape, soft matte toy coloring and proportions; consistent neutral low contrast lighting, flat pure white background, no floor, absolutely no cast shadows, no grey horizon, no drop shadow, no text or panel outlines, no perspective. Identical scale, pose and groundline between elevation panels. Ortho 3D asset source plates; do not present in three-quarter view. Only four birds in this image, including the top view on the far left.
