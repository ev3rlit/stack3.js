# Future Tank

Open the assembled example from the repository root.

```sh
npm run cli -- project open samples/future-tank/future-tank.stack3.json --playground
```

Press **Play**. Use **A/D** to turn the chassis and **Q/E** to turn the turret and barrel. Open **4-view comparison** from the project toolbar to see the reconstruction gallery. The **Layers**, **Spacing**, and **Explode** controls adjust the previews.

The project embeds the hull, turret, and barrel as separate four-view atlases. Each source PNG uses TOP, LEFT, FRONT, REAR order. The complete vehicle sheet, [future-tank-4view.png](future-tank-4view.png), is a reference for the original composition.

| Part | Atlas |
| --- | --- |
| Lower chassis | [hull-4view.png](hull-4view.png) |
| Turret | [turret-4view.png](turret-4view.png) |
| Barrel and mount | [barrel-4view.png](barrel-4view.png) |
