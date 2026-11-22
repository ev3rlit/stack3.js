import { bindTrackedDrive, bindVehicleWheels, builtinComponents, isBuiltInTrackedDriveSource, isBuiltInVehicleSource, type SceneScript } from './scripts';
import type { ProjectAction, ProjectSummary, SceneNode } from './project';

type PresetScene = Pick<ProjectSummary, 'nodes' | 'atlases'>;

function resolveWheels(project: PresetScene, root: SceneNode, explicit?: string) {
  const atlases = new Set(project.atlases.map(atlas => atlas.id));
  const children = project.nodes.filter(node => node.parentId === root.id && node.atlasId && atlases.has(node.atlasId));
  if (explicit !== undefined) {
    const ids = explicit.split(',').map(id => id.trim());
    if (ids.length !== 4 || new Set(ids).size !== 4 || ids.some(id => !id)) {
      throw new Error('--wheels requires four distinct node IDs in front-left, front-right, rear-left, rear-right order.');
    }
    return ids.map(id => {
      const node = children.find(child => child.id === id);
      if (!node) throw new Error('Wheel must be an atlas-backed direct child of ' + root.id + ': ' + id);
      return node;
    });
  }

  const named = children.filter(node => /wheel|tire|tyre|바퀴|타이어/i.test(node.name + ' ' + node.id));
  const byAtlas = new Map<string, SceneNode[]>();
  for (const child of children) {
    const group = byAtlas.get(child.atlasId!) ?? [];
    group.push(child);
    byAtlas.set(child.atlasId!, group);
  }
  const matched = [...byAtlas.values()].filter(group => group.length === 4 && named.every(wheel => group.includes(wheel)));
  const candidates = named.length === 4 ? named : children.length === 4 ? children : matched.length === 1 ? matched[0] : null;
  if (!candidates) throw new Error('Cannot identify four wheels under ' + root.id + '. Supply --wheels <front-left,front-right,rear-left,rear-right>.');
  const ordered = [...candidates].sort((a, b) => a.position[2] - b.position[2]);
  const bySide = (a: SceneNode, b: SceneNode) => a.position[0] - b.position[0];
  return [...ordered.slice(0, 2).sort(bySide), ...ordered.slice(2).sort(bySide)];
}

function addComponent(actions: ProjectAction[], node: SceneNode, id: keyof typeof builtinComponents,
  script: Omit<SceneScript, 'id'>) {
  const matches = (node.scripts ?? []).filter(entry => entry.id === id || entry.name === script.name ||
    (id === 'wasd-vehicle' ? isBuiltInVehicleSource(entry.source) : entry.source === script.source));
  if (matches.length > 1) throw new Error('Multiple ' + script.name + ' components on node ' + node.id + '.');
  const existing = matches[0];
  if (!existing) {
    actions.push({ action: 'script.set', nodeId: node.id, id, patch: script });
    return id;
  }
  if (existing.source !== script.source) {
    const canRebind = (id === 'wasd-vehicle' && isBuiltInVehicleSource(existing.source)) ||
      (id === 'tracked-drive' && isBuiltInTrackedDriveSource(existing.source));
    if (!canRebind) {
      throw new Error('Cannot replace customized ' + script.name + ' source on node ' + node.id + '.');
    }
    actions.push({ action: 'script.set', nodeId: node.id, id: existing.id, patch: { source: script.source } });
  }
  return existing.id;
}

export function fourWheelPreset(project: PresetScene, rootId: string, explicit?: string) {
  const root = project.nodes.find(node => node.id === rootId);
  if (!root) throw new Error('Unknown vehicle root: ' + rootId);
  const wheels = resolveWheels(project, root, explicit);
  const [fl, fr, rl, rr] = wheels;
  if (Math.max(fl.position[2], fr.position[2]) >= Math.min(rl.position[2], rr.position[2]) ||
      Math.max(fl.position[0], rl.position[0]) >= Math.min(fr.position[0], rr.position[0])) {
    throw new Error('Wheel positions must form two axles facing local −Z, with left wheels at smaller local X.');
  }
  const wheelbase = ((rl.position[2] + rr.position[2]) - (fl.position[2] + fr.position[2])) / 2 * root.scale[2];
  const wheelRadius = wheels.reduce((total, wheel) => {
    const { format, height, spacing } = wheel.settings;
    return total + height * wheel.scale[1] * (format === 'stack' ? spacing : 1) / 2;
  }, 0) / 4 * root.scale[1];
  if (![wheelbase, wheelRadius].every(value => value > 0 && value <= 100000)) {
    throw new Error('Vehicle wheelbase and radius must be positive and at most 100000 scene units.');
  }
  const actions: ProjectAction[] = [];
  const driver = addComponent(actions, root, 'wasd-vehicle', bindVehicleWheels(wheels.map(wheel => wheel.id), wheelbase, wheelRadius));
  const placements = wheels.map((wheel, i) => ({
    role: ['front-left', 'front-right', 'rear-left', 'rear-right'][i],
    node: wheel.id,
    component: addComponent(actions, wheel, 'sprite-stack-wheel', builtinComponents['sprite-stack-wheel'].script),
  }));
  return { actions, root: root.id, component: driver, wheels: placements };
}

export function trackedTankPreset(project: PresetScene, rootId: string) {
  const root = project.nodes.find(node => node.id === rootId);
  if (!root) throw new Error('Unknown tank root: ' + rootId);
  const children = project.nodes.filter(node => node.parentId === root.id);
  const atlasById = new Map(project.atlases.map(atlas => [atlas.id, atlas]));
  const atlas = (node: SceneNode) => node.atlasId ? atlasById.get(node.atlasId) : undefined;
  const tracks = children.filter(node => {
    const source = atlas(node);
    return source && /track|tread|트랙|궤도/i.test([node.name, node.id, source.name].join(' '));
  }).sort((a, b) => a.position[0] - b.position[0]);
  if (tracks.length !== 2 || tracks[0].position[0] >= 0 || tracks[1].position[0] <= 0) {
    throw new Error('Provide two atlas-backed track children with track or tread in their names, one on each side of the root.');
  }
  const turrets = children.filter(node => {
    const source = atlas(node);
    if (/turret|포탑/i.test([node.name, node.id, source?.name].join(' '))) {
      return source || project.nodes.some(child => child.parentId === node.id && atlas(child));
    }
    return false;
  });
  if (turrets.length !== 1) throw new Error('Provide one turret child or a named turret pivot with an atlas-backed child.');
  const actions: ProjectAction[] = [];
  const component = addComponent(actions, root, 'tracked-drive', bindTrackedDrive(
    tracks.map(track => track.id), tracks.map(track => track.position[0] * root.scale[0]),
  ));
  const turretComponent = addComponent(actions, turrets[0], 'turret-control', builtinComponents['turret-control'].script);
  const placements = tracks.map((track, i) => {
    if (track.settings.format !== 'stack') {
      throw new Error(track.name + ' must use Sprite stack to animate its belt.');
    }
    return { role: i === 0 ? 'left' : 'right', node: track.id,
      component: addComponent(actions, track, 'track-belt', builtinComponents['track-belt'].script) };
  });
  return { actions, root: root.id, component, turret: { node: turrets[0].id, component: turretComponent }, tracks: placements };
}
