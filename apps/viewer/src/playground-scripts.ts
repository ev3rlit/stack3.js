import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten-core';
import type { ProjectSummary, SceneNode, SceneScript, Vec3 } from '@stack3/core';

type WheelOptions = { rollScale: number; steeringScale: number };
type Offset = { translation?: Vec3; rotation?: Vec3; wheelRotation?: Vec3; stackWheel?: WheelOptions; trackBelt?: number; trackTravel?: number };
type ScriptResult = { translation?: Vec3; rotation?: Vec3; childRotations?: Record<string, Vec3>; stackWheel?: WheelOptions;
  trackBelt?: number; childTrackTravel?: Record<string, number>; state?: unknown };
type VM = { runtime: QuickJSRuntime; context: QuickJSContext; update: QuickJSHandle; limit: (at: number) => void };
type Instance = { node: SceneNode; script: SceneScript; vm?: VM; output?: ScriptResult; failed?: boolean };
const zero: Vec3 = [0, 0, 0];
const keyOf = (node: string, script: string) => node + '/' + script;

function createVM(engine: QuickJSWASMModule, source: string): VM {
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(4 * 1024 * 1024);
  runtime.setMaxStackSize(256 * 1024);
  let deadline = performance.now() + 30;
  runtime.setInterruptHandler(() => performance.now() >= deadline);
  const context = runtime.newContext();
  try {
    const update = context.unwrapResult(context.evalCode(`(() => {
      "use strict";
      const parse = JSON.parse, stringify = JSON.stringify;
      const callback = (() => {
        ${source}
        if (typeof update !== 'function') throw new Error('Define function update(input).');
        return update;
      })();
      return json => {
        const output = stringify(callback(parse(json)) ?? {});
        if (!output || output.length > 16384) throw new Error('Script output must be JSON of 16 KB or less.');
        return output;
      };
    })()`, 'component.js'));
    return { runtime, context, update, limit: at => { deadline = at; } };
  } catch (error) {
    context.dispose();
    runtime.dispose();
    throw error;
  }
}

function dispose(vm?: VM) {
  if (!vm) return;
  vm.update.dispose();
  vm.context.dispose();
  vm.runtime.dispose();
}

function vector(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 &&
    value.every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 10000);
}

function wheelOptions(value: unknown): value is WheelOptions {
  if (!value || typeof value !== 'object') return false;
  const { rollScale, steeringScale } = value as WheelOptions;
  return [rollScale, steeringScale].every(n => Number.isFinite(n) && Math.abs(n) <= 4);
}

function recordOf(value: unknown, valid: (item: unknown) => boolean) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(valid);
}

function run(vm: VM, input: string, deadline: number): ScriptResult {
  vm.limit(deadline);
  const { context, update } = vm;
  const arg = context.newString(input);
  try {
    const result = context.unwrapResult(context.callFunction(update, context.undefined, arg));
    const output: ScriptResult = result.consume(value => JSON.parse(context.getString(value)));
    if (!output || typeof output !== 'object' || Array.isArray(output) ||
        (output.translation !== undefined && !vector(output.translation)) ||
        (output.rotation !== undefined && !vector(output.rotation)) ||
        (output.stackWheel !== undefined && !wheelOptions(output.stackWheel)) ||
        (output.childRotations !== undefined && !recordOf(output.childRotations, vector)) ||
        (output.trackBelt !== undefined && (!Number.isFinite(output.trackBelt) || Math.abs(output.trackBelt) > 4)) ||
        (output.childTrackTravel !== undefined && !recordOf(output.childTrackTravel, item =>
          typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1e9))) {
      throw new Error('Return valid finite transform, wheel, and track outputs.');
    }
    return output;
  } finally { arg.dispose(); }
}

export function makePlaygroundScripts(report: (node: string, script: string, message: string) => void) {
  const keys = new Set<string>();
  const instances = new Map<string, Instance>();
  const offsets = new Map<string, Offset>();
  const messages = new Map<string, string>();
  let load: Promise<QuickJSWASMModule> | undefined;
  let state: ProjectSummary | undefined;
  let lastTime: number | undefined;

  function status(instance: Instance, message: string) {
    const { node, script } = instance;
    messages.set(keyOf(node.id, script.id), message);
    report(node.id, script.id, message);
  }

  function sync(project: ProjectSummary) {
    const reset = state && state.play.resetCount !== project.play.resetCount;
    state = project;
    const wanted = new Set<string>();
    for (const node of project.nodes) for (const script of node.scripts ?? []) {
      const key = keyOf(node.id, script.id);
      if (!script.enabled) continue;
      wanted.add(key);
      const previous = instances.get(key);
      if (!reset && previous && previous.script.source === script.source) {
        previous.node = node;
        previous.script = script;
        continue;
      }
      dispose(previous?.vm);
      const instance: Instance = { node, script };
      instances.set(key, instance);
      status(instance, 'Loading script…');
      load ??= import('./script-engine').then(module => module.createScriptEngine()).catch(error => {
        load = undefined;
        throw error;
      });
      void load.then(engine => {
        if (instances.get(key) !== instance) return;
        instance.vm = createVM(engine, script.source);
        status(instance, 'Ready');
      }).catch(error => {
        if (instances.get(key) !== instance) return;
        instance.failed = true;
        status(instance, String(error).slice(0, 500));
      });
    }
    for (const [key, instance] of instances) if (!wanted.has(key)) {
      dispose(instance.vm);
      instances.delete(key);
      messages.delete(key);
    }
    if (reset || !instances.size) {
      keys.clear();
      offsets.clear();
      lastTime = undefined;
    }
  }

  function add(id: string, field: 'translation' | 'rotation' | 'wheelRotation', value?: Vec3) {
    if (!value) return;
    const offset = offsets.get(id) ?? {};
    const prior = offset[field] ?? zero;
    offset[field] = [prior[0] + value[0], prior[1] + value[1], prior[2] + value[2]];
    offsets.set(id, offset);
  }

  function tick(time: number) {
    const dt = lastTime === undefined ? 0 : Math.min(.05, Math.max(0, time - lastTime));
    lastTime = time;
    if (!state || !instances.size) return offsets;
    offsets.clear();
    const running = state.play.startedAt !== null && dt > 0 && !document.hidden;
    const deadline = performance.now() + 8;
    for (const instance of instances.values()) {
      const { node, script, vm } = instance;
      if (!vm || instance.failed) continue;
      const children = state.nodes.filter(child => child.parentId === node.id);
      if (running && performance.now() < deadline) {
        try {
          instance.output = run(vm, JSON.stringify({
            dt, time, keys: [...keys], fields: Object.fromEntries(script.fields.map(field => [field.name, field.value])),
            state: instance.output?.state ?? {}, position: node.position, rotation: node.rotation,
            children: children.map(({ id, name, position }) => ({ id, name, position })),
          }), Math.min(deadline, performance.now() + 4));
        } catch (error) {
          // Preserve the last good pose until reset, removal, or a source edit.
          instance.failed = true;
          status(instance, String(error).slice(0, 500));
        }
      }
      const output = instance.output;
      if (!output) continue;
      add(node.id, 'translation', output.translation);
      add(node.id, 'rotation', output.rotation);
      if (output.stackWheel || output.trackBelt !== undefined) {
        const pose = offsets.get(node.id) ?? {};
        if (output.stackWheel) pose.stackWheel = output.stackWheel;
        if (output.trackBelt !== undefined) pose.trackBelt = output.trackBelt;
        offsets.set(node.id, pose);
      }
      for (const child of children) {
        if (output.childRotations && Object.hasOwn(output.childRotations, child.id)) {
          add(child.id, 'wheelRotation', output.childRotations[child.id]);
        }
        if (output.childTrackTravel && Object.hasOwn(output.childTrackTravel, child.id)) {
          const pose = offsets.get(child.id) ?? {};
          pose.trackTravel = (pose.trackTravel ?? 0) + output.childTrackTravel[child.id];
          offsets.set(child.id, pose);
        }
      }
    }
    return offsets;
  }

  return {
    sync, tick,
    hasScripts: () => instances.size > 0,
    keyDown: (code: string) => keys.add(code),
    keyUp: (code: string) => keys.delete(code),
    clearKeys: () => keys.clear(),
    status: (node: string, script: string) => messages.get(keyOf(node, script)) ?? '',
  };
}
