# CLI

Keep commands verb-first. The planned grammar is `stack3 <verb> <input> [options]`.

Implement the CLI and reconstruction in TypeScript and distribute the `stack3` command through npm. A published package must work outside the development checkout, including opening the bundled viewer. Verify this by installing the packed tarball in a clean directory and running `inspect`, `build`, and `view`.

| Verb | Required Behavior |
| --- | --- |
| `inspect` | Show mapped directions, dimensions, missing views, and alignment or mask warnings |
| `build` | Reconstruct the requested target and write to the requested file or directory |

Use `--layout` for an atlas. A manifest names individual images. Use `--format glb` or a `.glb` output path to save a mesh. Use `--format stack` and an output directory to save a sprite-stack bundle. The [CLI contract](../../apps/cli/README.md) contains command and manifest examples.

The CLI will use the same settings as the viewer. Invalid inputs should explain which view or option needs correction, and failed conversions should produce a nonzero exit status.

## Completion Check

Run the CLI against the same project used in the viewer. Both targets match the viewer's dimensions and pivot. An invalid or duplicate direction produces a readable error.
