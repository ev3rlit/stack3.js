import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Group, Quaternion, Vector3 } from 'three';
import { rotateAroundHub } from '../src/project-pose';

test('rolling and steering a ground-pivot wheel keep the hub fixed relative to the vehicle', () => {
  const vehicle = new Group();
  vehicle.position.set(2, 0, -3);
  vehicle.rotation.y = .7;
  const wheel = new Group();
  vehicle.add(wheel);
  const mount = new Vector3(-.238, 0, -.352);
  const hub = new Vector3(0, .32 * .98 / 2, 0);
  const rest = new Euler(.05, -.1, .08);
  wheel.scale.y = 1.2;
  wheel.position.copy(mount);
  wheel.rotation.copy(rest);
  const expected = wheel.localToWorld(hub.clone());
  for (let degrees = 0; degrees <= 360; degrees += 15) {
    wheel.position.copy(mount);
    wheel.rotation.copy(rest);
    rotateAroundHub(wheel, new Quaternion().setFromEuler(new Euler(degrees * Math.PI / 180, .55, 0, 'YXZ')), hub.y);
    assert.ok(wheel.localToWorld(hub.clone()).distanceTo(expected) < 1e-12);
  }
});
