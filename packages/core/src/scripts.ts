export type ScriptField = { name: string; label: string; value: number; min: number; max: number; step: number };
export type SceneScript = { id: string; name: string; source: string; enabled: boolean; fields: ScriptField[] };

export const stackWheelScript: Omit<SceneScript, 'id'> = {
  name: 'Sprite Stack Wheel',
  enabled: true,
  fields: [
    { name: 'rollScale', label: 'Roll multiplier', value: 1, min: -4, max: 4, step: .1 },
    { name: 'steeringScale', label: 'Steering multiplier', value: 1, min: -4, max: 4, step: .1 },
  ],
  source: `function update({ fields }) {
  return { stackWheel: { rollScale: fields.rollScale, steeringScale: fields.steeringScale } };
}`,
};

const text = { type: 'string' } as const;
const scalar = { type: 'number', minimum: -100000, maximum: 100000 } as const;
export const scriptFields = { name: text, label: text, value: scalar, min: scalar, max: scalar,
  step: { type: 'number', minimum: .0001, maximum: 100000 } } as const;

export function validateScript(script: SceneScript) {
  if (typeof script.source !== 'string' || !script.source.trim() || script.source.length > 16000) {
    throw new Error('Script source must contain 1–16,000 characters.');
  }
  const names = new Set<string>();
  for (const field of script.fields) {
    if (!/^[A-Za-z_]\w{0,47}$/.test(field.name) || names.has(field.name)) throw new Error('Invalid or repeated script field name: ' + field.name);
    if (!field.label.trim() || field.label.length > 80 || field.min >= field.max || field.value < field.min || field.value > field.max) {
      throw new Error('Invalid bounds or label for script field: ' + field.name);
    }
    names.add(field.name);
  }
}

function vehicleSource(wheels?: readonly string[]) {
  const routeWheels = wheels
    ? `  const wheels = ${JSON.stringify(wheels)};
  for (let i = 0; i < wheels.length; i++) {
    wheelRotations[wheels[i]] = [spin, i < 2 ? steering : 0, 0];
  }`
    : `  for (const child of children) {
    if (/wheel/i.test(child.name)) {
      wheelRotations[child.id] = [spin, /^front/i.test(child.name) ? steering : 0, 0];
    }
  }`;
  return `function update({ dt, keys, fields, state, rotation, children }) {
  const pressed = (...codes) => codes.some(code => keys.includes(code));
  const throttle = Number(pressed('KeyW', 'ArrowUp')) - Number(pressed('KeyS', 'ArrowDown'));
  const steer = Number(pressed('KeyA', 'ArrowLeft')) - Number(pressed('KeyD', 'ArrowRight'));
  const radians = Math.PI / 180;
  const target = throttle * (throttle < 0 ? fields.reverseSpeed : fields.forwardSpeed);
  const speed = state.speed || 0;
  const change = fields.acceleration * dt;
  const nextSpeed = speed + Math.max(-change, Math.min(change, target - speed));
  const distance = (speed + nextSpeed) * .5 * dt;
  const steering = steer * fields.steeringAngle;
  const turn = distance / fields.wheelbase * Math.tan(steering * radians) / radians;
  const yaw = ((state.yaw || 0) + turn) % 360;
  const heading = (rotation[1] + yaw - turn * .5) * radians;
  const x = (state.x || 0) - Math.sin(heading) * distance;
  const z = (state.z || 0) - Math.cos(heading) * distance;
  const spin = ((state.spin || 0) - distance / fields.wheelRadius / radians) % 360;
  const wheelRotations = {};
${routeWheels}
  return { state: { speed: nextSpeed, x, z, yaw, spin }, translation: [x, 0, z],
    rotation: [0, yaw, 0], childRotations: wheelRotations };
}`;
}

export const vehicleScript: Omit<SceneScript, 'id'> = {
  name: 'WASD Vehicle',
  enabled: true,
  fields: [
    { name: 'forwardSpeed', label: 'Forward speed', value: 1.25, min: 0, max: 8, step: .05 },
    { name: 'reverseSpeed', label: 'Reverse speed', value: .65, min: 0, max: 5, step: .05 },
    { name: 'acceleration', label: 'Acceleration', value: 2.8, min: .1, max: 15, step: .1 },
    { name: 'steeringAngle', label: 'Steering angle (°)', value: 32, min: 0, max: 65, step: 1 },
    { name: 'wheelbase', label: 'Wheelbase', value: .73, min: .05, max: 10, step: .01 },
    { name: 'wheelRadius', label: 'Wheel radius', value: .16, min: .01, max: 5, step: .01 },
  ],
  source: vehicleSource(),
};

export function bindVehicleWheels(wheels: readonly string[], wheelbase: number, wheelRadius: number): typeof vehicleScript {
  return { ...vehicleScript, source: vehicleSource(wheels), fields: vehicleScript.fields.map(field => {
    const value = field.name === 'wheelbase' ? wheelbase : field.name === 'wheelRadius' ? wheelRadius : field.value;
    return { ...field, value, min: Math.min(field.min, value), max: Math.max(field.max, value) };
  }) };
}

export function isBuiltInVehicleSource(source: string) {
  if (source === vehicleScript.source) return true;
  const bindings = /^  const wheels = (\[.*\]);$/m.exec(source);
  if (!bindings) return false;
  try {
    const ids: unknown = JSON.parse(bindings[1]);
    return Array.isArray(ids) && ids.length === 4 && ids.every(id => typeof id === 'string') && vehicleSource(ids) === source;
  } catch { return false; }
}

function trackedDriveSource(tracks: readonly (readonly [string, number])[]) {
  return `function update({ dt, keys, fields, state, rotation }) {
  const tracks = ${JSON.stringify(tracks)};
  const held = (...codes) => codes.some(code => keys.includes(code));
  const throttle = Number(held('KeyW', 'ArrowUp')) - Number(held('KeyS', 'ArrowDown'));
  const direction = Number(held('KeyA', 'ArrowLeft')) - Number(held('KeyD', 'ArrowRight'));
  const target = throttle * (throttle < 0 ? fields.reverseSpeed : fields.forwardSpeed);
  const oldSpeed = state.speed ?? 0;
  const speed = oldSpeed + (target - oldSpeed) * (1 - Math.exp(-fields.response * dt));
  const distance = (oldSpeed + speed) * .5 * dt;
  const turn = direction * fields.turnRate * dt;
  const radians = Math.PI / 180;
  const previous = state.yaw ?? 0;
  const heading = (rotation[1] + previous + turn * .5) * radians;
  const yaw = (previous + turn) % 360;
  const x = (state.x ?? 0) - Math.sin(heading) * distance;
  const z = (state.z ?? 0) - Math.cos(heading) * distance;
  const travel = tracks.map((track, i) => (state.travel?.[i] ?? 0) + distance + turn * radians * track[1]);
  return { translation: [x, 0, z], rotation: [0, yaw, 0],
    childTrackTravel: Object.fromEntries(tracks.map((track, i) => [track[0], travel[i]])),
    state: { speed, yaw, x, z, travel } };
}`;
}

const trackedDrive: Omit<SceneScript, 'id'> = {
  name: 'Tracked Drive', enabled: true,
  fields: [
    { name: 'forwardSpeed', label: 'Forward speed', value: .74, min: 0, max: 3, step: .01 },
    { name: 'reverseSpeed', label: 'Reverse speed', value: .39, min: 0, max: 2, step: .01 },
    { name: 'turnRate', label: 'Hull turn (°/s)', value: 83, min: 0, max: 180, step: 1 },
    { name: 'response', label: 'Throttle response', value: 9, min: .1, max: 24, step: .1 },
  ],
  source: trackedDriveSource([]),
};

export function bindTrackedDrive(ids: readonly string[], lateralOffsets: readonly number[]) {
  return { ...trackedDrive, source: trackedDriveSource(ids.map((id, i) => [id, lateralOffsets[i]])) };
}

export function isBuiltInTrackedDriveSource(source: string) {
  const bindings = /^  const tracks = (\[.*\]);$/m.exec(source);
  if (!bindings) return false;
  try {
    const tracks: unknown = JSON.parse(bindings[1]);
    return Array.isArray(tracks) && tracks.every(track =>
      Array.isArray(track) && track.length === 2 && typeof track[0] === 'string' && Number.isFinite(track[1])) &&
      trackedDriveSource(tracks) === source;
  } catch { return false; }
}

const turretControl: Omit<SceneScript, 'id'> = {
  name: 'Turret Control', enabled: true,
  fields: [{ name: 'turnRate', label: 'Turret turn (°/s)', value: 85, min: 0, max: 180, step: 1 }],
  source: `function update({ dt, keys, fields, state }) {
  const input = Number(keys.includes('KeyQ')) - Number(keys.includes('KeyE'));
  const yaw = ((state.yaw ?? 0) + input * fields.turnRate * dt) % 360;
  return { rotation: [0, yaw, 0], state: { yaw } };
}`,
};

const trackBelt: Omit<SceneScript, 'id'> = {
  name: 'Track Belt', enabled: true,
  fields: [{ name: 'travelScale', label: 'Belt travel multiplier', value: 1, min: -4, max: 4, step: .1 }],
  source: `function update({ fields }) {
  return { trackBelt: fields.travelScale };
}`,
};

export const builtinComponents = {
  'wasd-vehicle': { description: 'Drive a vehicle with WASD or arrow keys and send roll and steering to its wheels.', script: vehicleScript },
  'sprite-stack-wheel': { description: 'Resample a rolling wheel stack and apply steering around the hub.', script: stackWheelScript },
  'tracked-drive': { description: 'Drive a tracked vehicle with WASD. The tank preset binds the two tread travel outputs.', script: trackedDrive },
  'turret-control': { description: 'Turn the selected turret pivot independently with Q and E.', script: turretControl },
  'track-belt': { description: 'Animate tread texture around a Sprite stack belt using travel from its parent.', script: trackBelt },
};
