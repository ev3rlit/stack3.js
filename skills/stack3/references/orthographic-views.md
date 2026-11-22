# Orthographic Source Preparation

## Choose a source

For an existing model, render from exact orthographic cameras. Set TOP directly above the asset, aligned with its vertical axis, and point the image’s up direction toward the rear. Reuse the same world units per pixel for every panel. Use this render as a geometry reference when generating a matching illustration.

For generated images, use a supplied reference or one accepted view as the identity reference. Request either separate frames or a clean atlas. Prefer separate frames when replacing a single panel. Keep the user's existing materials, linework, color, and lighting style throughout. Specify an art style only when requested or already established by the source.

Use the [four-view atlas prompt](../SKILL.md#generate-the-four-views) for the first pass. For a single-panel correction, use the [TOP repair prompt](../SKILL.md#replace-a-tilted-top) or the [LEFT repair prompt](../SKILL.md#replace-an-incorrect-left) with the accepted views as references.

## Replace a tilted TOP

1. Compare silhouettes on the same scale. Check TOP width against FRONT/REAR width, TOP length against LEFT length, and LEFT height against FRONT/REAR height. Track recognizable roof edges, handles, axles, or base corners. Pairs lying on the same vertical line in the elevations should align in TOP.
2. Reject a candidate that clearly exposes a vertical front or side wall, shows parallax between upper and lower landmarks, or has perspective convergence. A slope, overhang, or horizontal step can be visible in a true TOP. For a symmetric asset or weak visual evidence, use a known orthographic reference or report that the camera cannot be confirmed.
3. Regenerate just TOP with the accepted views as references and restate the plan camera, orientation, and expected footprint. Avoid stretching or applying a perspective warp as a substitute for a corrected view. It cannot realign features at different heights. Recheck the replacement before rebuilding. Preserve the accepted views and the original source file.
