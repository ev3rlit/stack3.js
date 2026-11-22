export const sources = {
  cone: new URL('../../../samples/props/traffic-cone-4view.png', import.meta.url),
  rover: new URL('../../../samples/rover/fillet-rover-body-4-view.png', import.meta.url),
  inspection: new URL('../../../samples/inspection/inspection-robot-body-4-view.png', import.meta.url),
  ant: new URL('../../../samples/ant/ant-mech-body-4view.png', import.meta.url),
  tank: new URL('../../../samples/tank/tank-hull-4view.png', import.meta.url),
  sign: new URL('../../../samples/props/wet-floor-sign-4view.png', import.meta.url),
  barrier: new URL('../../../samples/props/plastic-barrier-4view.png', import.meta.url),
  concrete: new URL('../../../samples/props/concrete-barrier-4view.png', import.meta.url),
};

export const qualities = {
  draft: { layers: 24, resolution: 72 },
  balanced: { layers: 48, resolution: 96 },
  detail: { layers: 90, resolution: 144 },
};

import type { PartLayout, XYZ } from './assembly';

export type PresetPart = PartLayout & { url: URL; size?: XYZ };
const wheelRover = new URL('../../../samples/rover/fillet-rover-wheel-4-view.png', import.meta.url);
const wheelInspection = new URL('../../../samples/inspection/inspection-robot-wheel-4-view.png', import.meta.url);
const legCenter = new URL('../../../samples/ant/ant-mech-center-leg-4view.png', import.meta.url);
const legAngled = new URL('../../../samples/ant/ant-mech-angled-leg-4view.png', import.meta.url);
const turret = new URL('../../../samples/tank/tank-turret-4view.png', import.meta.url);
const track = new URL('../../../samples/tank/tank-track-4view.png', import.meta.url);

const xyz = (x: number, y: number, z: number, unit: number): XYZ => [x / unit, y / unit, z / unit];
function vehicle(body: URL, wheel: URL, size: XYZ, wheelSize: XYZ, clearance: number, front: number, rear: number, halfTrack: number): PresetPart[] {
  const unit = size[2];
  return [
    { name: 'Body', url: body, size: xyz(...size, unit), mounts: [{ name: 'Body', position: xyz(0, 0, clearance, unit) }] },
    { name: 'Wheel', url: wheel, size: xyz(...wheelSize, unit),
      mounts: [-1, 1].flatMap(side => [front, rear].map((axle, index) => ({
        name: (side < 0 ? 'Left ' : 'Right ') + (index ? 'rear wheel' : 'front wheel'),
        position: xyz(side * halfTrack, axle, 0, unit), mirrorX: side < 0,
      }))) },
  ];
}

export const multipartPresets: Partial<Record<keyof typeof sources, PresetPart[]>> = {
  rover: vehicle(sources.rover, wheelRover, [80, 188, 90], [20, 44, 44], 13, 48.5, -56.5, 36.5),
  inspection: vehicle(sources.inspection, wheelInspection, [92, 194, 150], [30, 74, 74], 14, 45, -63, 46.5),
  ant: [
    { name: 'Body', url: sources.ant, size: xyz(50, 114, 56, 56), mounts: [{ name: 'Body', position: xyz(0, 0, 26, 56) }] },
    { name: 'Center leg', url: legCenter, size: xyz(23, 17, 41, 56), mounts: [-1, 1].map(side => ({
      name: side < 0 ? 'Left center leg' : 'Right center leg', position: xyz(side * 27, 0, 0, 56), mirrorX: side < 0,
    })) },
    { name: 'Angled leg', url: legAngled, size: xyz(23, 30, 41, 56), mounts: [-1, 1].flatMap(side => [-1, 1].map(end => ({
      name: (side < 0 ? 'Left ' : 'Right ') + (end < 0 ? 'rear leg' : 'front leg'),
      position: xyz(side * 27, end * 42, 0, 56), mirrorX: side < 0, mirrorY: end < 0,
    }))) },
  ],
  tank: [
    { name: 'Hull', url: sources.tank, size: xyz(86, 166, 49, 49), mounts: [{ name: 'Hull', position: xyz(0, 0, 13, 49) }] },
    { name: 'Turret', url: turret, size: xyz(60, 120, 33, 49), mounts: [{ name: 'Turret', position: xyz(0, 15, 60, 49) }] },
    { name: 'Track', url: track, size: xyz(23, 163, 34, 49), mounts: [-1, 1].map(side => ({
      name: side < 0 ? 'Left track' : 'Right track', position: xyz(side * 45, 0, 0, 49), mirrorX: side < 0,
    })) },
  ],
};
