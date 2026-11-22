# Demo Atlases

The original demo PNGs are byte-for-byte copies from the Sprite Stacking Demo. The vehicle and prop folders mirror the demo’s `assets/` tree. The `experiments/` folder mirrors the prototype demos, including matching copies of the tank part atlases. Earlier and later versions keep their original filenames.

Start with the traffic cone to verify a local CLI installation.

```sh
npm run cli -- inspect samples/props/traffic-cone-4view.png --layout top,left,front,rear
```

Check the view order and artwork before converting each sample. Some concept sheets contain labels, crowded panels, or backgrounds that need cropping into individual views.

The [Future Tank](future-tank/README.md) example includes a complete scene project and its three part atlases.
