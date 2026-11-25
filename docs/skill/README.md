# Agent Skill

The skill guides an agent from orthographic source preparation to 2D sprite-stack conversion and review in Blender by default.

## Required Behavior

- Explain the supported view directions, alignment conventions, and transparent or flat backgrounds.
- Preserve the input style by default. Make pixel-art treatment opt-in.
- Inspect TOP for orthographic alignment and replace a tilted panel before carving. CLI proportion warnings support this visual check.
- From a subject or photo, generate the four-view PNG with the skill prompt first. Reuse validated view images when supplied.
- Build the stack, then reopen its bundle to extract a requested surface mesh. Blender handles review, viewing and finishing. Use it upstream when calibration or rendering of a designated source requires it.
- Verify the output at more than one angle and report its actual dimensions and pivot.
- Credit the original sprite-stacking workflow and keep examples aligned with the implemented CLI.

## Completion Check

Following the skill with a sample atlas produces a saved stack that can be previewed in Blender and meshed without the source atlas. Preview filters can change independently of the slice data, and returning to a previous reconstruction setting within the same session reuses its cached result.
