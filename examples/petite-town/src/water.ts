import { Color, DoubleSide, ShaderMaterial, Vector4 } from 'three'

const vertexShader = /* glsl */ `
  uniform vec4 wellBounds;
  varying vec2 surface;
  void main() {
    #ifdef WELL
      surface = (position.xz - wellBounds.xy) * wellBounds.zw;
    #else
      surface = uv; // Across the channel [0, 1], then downstream distance in metres.
    #endif
    vec4 point = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      point = instanceMatrix * point;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * point;
  }
`

const fragmentShader = /* glsl */ `
  uniform float time;
  uniform vec3 deep, shallow, glint;
  varying vec2 surface;

  // A soft, brush-width line with an antialiased edge at village scale.
  float brush(float phase, float width) {
    float edge = min(0.22, max(0.015, fwidth(phase)));
    return 1.0 - smoothstep(width, width + edge, abs(fract(phase + 0.5) - 0.5));
  }

  void main() {
    float wash, light;
    #ifdef WELL
      vec2 p = surface;
      float r = length(p - vec2(0.04, -0.06));
      float angle = atan(p.y + 0.06, p.x - 0.04);
      float wobble = 0.055 * sin(3.0 * angle + r * 3.0 - time * 0.45);
      float arcs = smoothstep(-0.4, 0.75, sin(angle * 2.0 + r * 4.0 + time * 0.32));
      float wave = r * 2.25 - time * 0.47 + wobble;
      wash = 0.42 + 0.18 * sin(4.0 * p.x - 2.0 * p.y + time * 0.5)
                  + 0.14 * cos(6.28 * wave);
      wash *= 1.0 - 0.72 * smoothstep(0.62, 1.0, length(p));
      light = brush(wave, 0.045) * arcs * smoothstep(0.05, 0.25, r) * 0.68;
    #else
      float across = surface.x;
      float downstream = surface.y - time * 0.38;
      float bend = 0.04 * sin(downstream * 3.6 + across * 8.0);
      float lane = (across + bend) * 4.6;
      float along = downstream * 1.9 + 0.38 * sin(lane * 2.7);
      float strokes = brush(lane, 0.092)
                    * smoothstep(0.15, 0.83, sin(along * 4.0 + lane * 3.0));
      float bank = smoothstep(0.27, 0.49, abs(across - 0.5));
      wash = 0.34 + 0.40 * bank + 0.12 * sin(lane * 2.8 + downstream * 1.5)
                  + 0.08 * sin(along * 3.3);
      light = strokes * (0.46 + 0.16 * bank);
    #endif
    vec3 paint = mix(deep, shallow, clamp(wash, 0.0, 1.0));
    gl_FragColor = vec4(mix(paint, glint, light), 1.0);
    #include <colorspace_fragment>
  }
`

export function createWater() {
  const time = { value: 0 }
  function material(well: boolean) {
    return new ShaderMaterial({
      name: well ? 'Well ripples' : 'Creek current',
      defines: well ? { WELL: 1 } : {},
      uniforms: {
        time,
        wellBounds: { value: new Vector4() },
        deep: { value: new Color(well ? '#28585b' : '#498b90') },
        shallow: { value: new Color(well ? '#69a6a0' : '#92bdb0') },
        glint: { value: new Color('#c7dcbe') },
      },
      vertexShader,
      fragmentShader,
      side: DoubleSide,
    })
  }
  return { time, well: material(true), creek: material(false) }
}
