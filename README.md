# stack3.js

stack3.js reconstructs game assets from four or six orthographic images. The same input can produce a **3D mesh** or a **runtime sprite stack**.

## Quick Start

```sh
npm ci
npm run viewer
```

Open the local URL printed by Vite and choose **Traffic Cone** under **Sample asset**. Select **Sprite stack** or **3D mesh** independently of the **CPU** or **GPU** preview renderer. Open **Demo yard** to drive the original demo vehicles and test props.

For an editable level controlled by an agent, use the [scene project commands](apps/cli/README.md#scene-projects). Import embeds source PNGs in the project and creates scene objects. The CLI and live editor share the same project file.

Open the [Future Tank example](samples/future-tank/README.md) to inspect a separately reconstructed chassis, turret, and barrel in Playground and the comparison gallery.

## Workflow

1. Import an atlas or separate images and assign each image to a direction. Align the silhouettes, scale, and ground line across views.
2. Reconstruct in a Web Worker for the browser or run the same core from the CLI. Preview the result as settings change.
3. Select **mesh** or **stack**. Use the reconstructed data directly in a runtime, or save it as a GLB or sprite-stack bundle.

| Input | Directions |
| --- | --- |
| Four views | Top, left, front, rear |
| Six views | Top, left, front, rear, right, bottom |

An atlas uses an explicit view layout. A set of individual images uses a manifest with named directions. The core receives the same normalized view set from either input. Six views provide color for the right and bottom faces. Surfaces hidden from all silhouettes may require shape corrections.

## Repository Layout

| Path | Responsibility |
| --- | --- |
| [`packages/core`](packages/core/README.md) | TypeScript reconstruction, settings, and shared asset data |
| [`packages/three`](packages/three/README.md) | Three.js mesh and sprite-stack adapters |
| [`apps/cli`](apps/cli/README.md) | File input, reproducible conversion, and export |
| [`apps/viewer`](apps/viewer/README.md) | Interactive alignment, live preview, and export |
| [`apps/web`](apps/web/README.md) | Documentation and a browser playground that reuses the viewer |
| [`skills/stack3`](skills/stack3/README.md) | Agent guidance for preparing views and validating exports |
| [`samples`](samples/README.md) | Original four-view PNGs from the sprite-stacking demos |

The core owns reconstruction and runs independently of Three.js and the UI. The viewer and CLI use the same project settings. Camera controls belong to the preview, while asset scale, pivot, and slice spacing belong to the reconstructed asset.

## Feature Plan

See the [feature plan](docs/README.md) for requirements, completion checks, and build order.

## CLI Direction

Commands follow **`stack3 <verb> <input> [options]`**. See the [CLI contract](apps/cli/README.md) for inputs and outputs.

```sh
npm run cli -- inspect apps/viewer/public/examples/traffic-cone-4view.png --layout top,left,front,rear
npm run cli -- build apps/viewer/public/examples/traffic-cone-4view.png --layout top,left,front,rear --format stack --output cone-stack/
npm run cli -- view cone-stack/
npm run cli -- build apps/viewer/public/examples/traffic-cone-4view.png --layout top,left,front,rear --output cone.glb
```

## Verification

Run `npm test` for reconstruction and export checks. Run `npm run build` to type-check the workspace and build the static viewer under `apps/viewer/dist/`.

Use the [stack3 skill](skills/stack3/SKILL.md) for agent-assisted asset preparation and export review.

## First End-to-End Check

Reconstruct one traffic cone from individual views and from an atlas. The viewer and CLI should agree on its dimensions, pivot, and appearance when given the same settings. The mesh and stack should both load into a Three.js scene, and the exported GLB should open in the viewer.

## References

The four-view sprite-stacking workflow draws on Daniel White's work. Earlier experiments explored runtime reconstruction, multi-view texturing, and GPU instancing. [Sprite Stacking skill](https://github.com/danielwh2/sprite-stacking) · [Sprite Stacking Demo](https://github.com/ev3rlit/sprite-stacking-demo)
