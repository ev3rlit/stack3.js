# Agent Skill

The skill guides an agent from orthographic source preparation to 2D sprite-stack conversion and review in the viewer.

## Required Behavior

- Explain the supported view directions, alignment conventions, and transparent or flat backgrounds.
- Preserve the input style by default. Make pixel-art treatment opt-in.
- Inspect TOP for orthographic alignment and replace a tilted panel before carving. CLI proportion warnings support this visual check.
- Build the stack and open the written bundle with the CLI's verb-first commands.
- Verify the output at more than one angle and report its actual dimensions and pivot.
- Credit the original sprite-stacking workflow and keep examples aligned with the implemented CLI.

## Completion Check

Following the skill with a sample atlas produces a stack that reopens in the viewer. Preview filters can change independently of the slice data, and returning to a previous reconstruction setting within the same session reuses its cached result.
