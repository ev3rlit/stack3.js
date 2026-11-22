# Demo Yard

For a single offline file, run `npm run build:demo` from the repository root and open `examples/demo-yard.html`. See the [one-line launch commands](../../README.md#play-the-demo-yard) to download and open the published demo.

For development, serve the map from the repository root.

```sh
npm ci
npm run demo
```

Open the local URL printed by Vite. The build copies the self-contained `index.html` into the examples folder. It is mounted at **Demo yard** in the main viewer and copied into the static web and installed CLI builds.

Choose **Armored Miniature** to enter manual driving mode. Use **W/S** to move, **A/D** to steer, the mouse to aim the turret, and **click/F** to fire. **Space** stops the vehicle. Cones and wet-floor signs can tip over, plastic barriers can slide, and concrete barriers block the vehicle. Tank impacts can move nearby props. Use **Reset Props** to restore the yard, or **Add Prop PNG** to load a custom four-view prop.

Other vehicles and the standard and dense layouts come from the original demo. The standalone file retains the stack3.js rendering and custom-prop controls. [Original Sprite Stacking Demo snapshot](https://github.com/ev3rlit/sprite-stacking-demo/tree/8b8bb05554404537fc59cb030aeb6851b5c00ba0)
