import { Vector3, type Object3D, type Quaternion } from 'three';

const hub = new Vector3();

export function rotateAroundHub(object: Object3D, rotation: Quaternion, centerY: number) {
  // Keep the hub fixed in parent space even when the atlas uses a ground pivot.
  const scaledCenter = centerY * object.scale.y;
  object.position.add(hub.set(0, scaledCenter, 0).applyQuaternion(object.quaternion));
  object.quaternion.multiply(rotation);
  object.position.sub(hub.set(0, scaledCenter, 0).applyQuaternion(object.quaternion));
}
