# stack3 Skill

## Install in Codex

Install the [stack3 CLI](../../apps/cli/README.md#installation), then run the skills.sh CLI from your project directory with Node.js 22.20 or later.

```sh
npx skills add ev3rlit/stack3.js --skill stack3 --agent codex
```

Invoke `$stack3` with a subject or photo to generate atlas images, build sprite stacks, and extract surface meshes from the saved layers. Blender is the default viewer and finishing workspace. Try asking it to open the bundled Future Tank example and show the reconstruction gallery. Restart Codex if the skill does not appear. [Codex skill installation and discovery](https://learn.chatgpt.com/docs/build-skills#install-curated-skills-for-local-use)

See the [Usage prompts](../../README.md#usage) for atlas generation, Playground testing, and export. Read [SKILL.md](SKILL.md) for the full agent workflow.

Use `stack3 capabilities --json` to discover the installed CLI's supported features, backends, and sample paths. The [hard-surface reference folder](references/hard-surface/README.md) bundles runnable YAML recipes and JSON Schemas.

The original [Sprite Stacking skill](https://github.com/danielwh2/sprite-stacking) is the starting reference for the four-view carving workflow.

[Agent skill requirements](../../docs/skill/README.md)
