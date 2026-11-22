# Validation

Use a few known source assets to verify the entire workflow. Record expected dimensions, pivot, and views for each input so failures can be isolated to import, reconstruction, rendering, or export.

| Fixture | What to Verify |
| --- | --- |
| Traffic cone | Atlas and individual image parity, ground contact, live mesh and stack, GLB and stack round trips |
| Plastic barrier | Thin details, long-axis proportion, consistent scale and appearance across viewpoints |
| Loader bucket | How exposed and hidden cavities behave, including shape corrections when needed |
| Six-view directional prop | Right and bottom textures are applied to the correct faces |

## Cross-Component Checks

- The viewer and CLI produce equivalent assets from the same source views and settings.
- Stale Worker results yield to the latest settings. Changing the target or its settings selects the matching cached result when one exists.
- A scene can use either output directly, and reopened exports agree on orientation, size, pivot, and appearance.
- Measure first reconstruction, cache reuse, and frame time separately when evaluating runtime performance.
