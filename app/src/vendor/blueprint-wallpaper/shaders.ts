// Vendored from kvnloo/blueprint 2817939 (GPL-3.0-only). See README.md.
/**
 * GLSL (WebGL1 / GLSL ES 1.00) for the Living Ruins player.
 *
 * Structure follows the reverse-engineered scene the .files player plays:
 * a static plate drawn into a ping-pong FBO, full-screen distortion passes
 * (waterripple + waterwaves families), then additive particles on top. On
 * our own art the passes are merged into three: scene (plate + parallax +
 * foliage sway), water (flow-map refraction + ripple normal + waves shear +
 * pointer ripples) and composite (light shafts, ember glow, fog, grade,
 * vignette). Every effect is a stateless function of time.
 */

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/** Shared plate mapping. See view.ts for the maths. */
const PLATE = `
const float PA = ${(16 / 9).toFixed(6)};
uniform vec4 u_view;   // sx, sy, ox, oy (plate units)
uniform vec2 u_par;    // parallax vector (plate units)
uniform sampler2D u_depth;
vec2 toPlate(vec2 uv) {
  vec2 p = vec2(uv.x, 1.0 - uv.y) * u_view.xy + u_view.zw;
  float d = texture2D(u_depth, p).r;
  return p + u_par * (d - 0.5);
}
vec2 plateToScreenDelta(vec2 dp) {
  return vec2(dp.x / u_view.x, -dp.y / u_view.y);
}
`;

const NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

export const VERT_QUAD = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/**
 * L0 + L5: plate with depth parallax and foliage sway.
 *
 * The G mask is a smooth "may sway" weight (0 on stone and architecture). The
 * amplitude is NOT the mask value alone: it follows the root-to-tip gradient,
 * i.e. how far up a foliage clump this pixel sits. Leaves with open space
 * above them (tips) swing fully, pixels buried deep in a clump (near the
 * root) barely move, and nearer foliage (larger plate y) swings more.
 */
export const FRAG_SCENE = `${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_base;
uniform sampler2D u_masks;
uniform float u_time;
uniform float u_sway;
${PLATE}
void main() {
  vec2 p = toPlate(v_uv);
  float fol = texture2D(u_masks, p).g;
  if (fol < 0.004) {
    gl_FragColor = vec4(texture2D(u_base, p).rgb, 1.0);
    return;
  }
  float t = u_time;
  // root-to-tip gradient: foliage cover above this pixel means it is nearer the root
  float above = texture2D(u_masks, p - vec2(0.0, 0.012)).g * 0.5
              + texture2D(u_masks, p - vec2(0.0, 0.028)).g * 0.5;
  float tip = clamp(1.0 - above * 0.8, 0.2, 1.0);
  float near = mix(0.55, 1.0, smoothstep(0.25, 0.95, p.y));
  float amp = u_sway * fol * tip * near;
  // two periods (~4 s and ~7 s) plus a slow gust envelope every 8-15 s
  float gust = 0.55 + 0.45 * smoothstep(0.35, 1.0, 0.5 + 0.5 * sin(t * 0.13) + 0.25 * sin(t * 0.37 + 1.3));
  float s = sin(t * 1.57 + p.y * 9.0 + p.x * 4.0) * 0.65 + sin(t * 0.9 + p.x * 13.0) * 0.35;
  p.x += s * amp * gust;
  p.y += cos(t * 1.21 + p.x * 7.0) * amp * 0.25 * gust;
  gl_FragColor = vec4(texture2D(u_base, p).rgb, 1.0);
}
`;

/** L1 + L2: flow-map water with refraction, ripple normal, waves shear, pointer ripples. */
export const FRAG_WATER = `${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_fb;
uniform sampler2D u_masks;
uniform sampler2D u_flow;
uniform sampler2D u_normal;
uniform float u_time;
uniform vec4 u_waves[3];   // dir.x, dir.y, scale, speed
uniform vec4 u_ripples[8]; // plate x, plate y, start time, strength
${PLATE}
vec2 nrm(vec2 c) { return texture2D(u_normal, c).xy * 2.0 - 1.0; }
void main() {
  vec2 p = toPlate(v_uv);
  vec3 fl = texture2D(u_flow, p).rgb;
  float fs = fl.b;
  float water = max(texture2D(u_masks, p).r, smoothstep(0.03, 0.3, fs));
  if (water < 0.004) {
    gl_FragColor = texture2D(u_fb, v_uv);
    return;
  }
  float t = u_time;
  vec2 dir = fl.rg * 2.0 - 1.0;
  vec2 q = p * vec2(PA, 1.0);

  // calm water: dual scrolling normal sample (waterripple structure, 2nd at 1.333x)
  vec2 sc = vec2(0.0, -1.0) * 0.044 * t;
  vec2 calm = nrm(q * 4.5 + sc) + nrm(q * 6.0 - sc * 0.7 + 0.37);

  // moving water: two-phase flow advection along the flow map
  float fall = smoothstep(0.6, 0.95, abs(dir.y)) * smoothstep(0.2, 0.6, fs);
  vec2 stretch = mix(vec2(1.0), vec2(2.4, 0.3), fall);
  vec2 fq = q * 7.0 * stretch;
  vec2 adv = dir * stretch * (0.5 + 1.4 * fs);
  float ph0 = fract(t * 0.22);
  float ph1 = fract(t * 0.22 + 0.5);
  float w = abs(1.0 - 2.0 * ph0);
  vec2 flowN = mix(nrm(fq - adv * ph0), nrm(fq - adv * ph1 + 0.5), w);
  vec2 n = mix(calm * 0.6, flowN, smoothstep(0.05, 0.4, fs));

  // waterwaves: directional sine shear, merged into one loop
  vec2 wave = vec2(0.0);
  for (int i = 0; i < 3; i++) {
    vec4 W = u_waves[i];
    wave += sin(t * W.w + dot(p, W.xy) * W.z) * vec2(W.y, -W.x);
  }
  wave *= 0.0011 * (1.0 - fs);

  // pointer ripples: expanding ring packets
  vec2 rip = vec2(0.0);
  float ring = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 R = u_ripples[i];
    float age = t - R.z;
    if (R.w <= 0.0 || age < 0.0 || age > 4.0) continue;
    vec2 dv = (p - R.xy) * vec2(PA, 1.0);
    float d = length(dv);
    float front = age * 0.11;
    float k = (d - front) * 24.0;
    float env = exp(-k * k) * exp(-age * 1.15) * R.w;
    float wv = sin((d - front) * 150.0);
    rip += dv / (d + 1e-4) * wv * env;
    ring += max(wv, 0.0) * env;
  }

  vec2 off = n * 0.0042 * (0.6 + fs) + wave + rip * 0.006;
  vec3 col = texture2D(u_fb, v_uv + plateToScreenDelta(off * water)).rgb;

  float glint = smoothstep(0.6, 1.2, dot(n, vec2(-0.45, -0.89)));
  col += vec3(0.85, 0.96, 1.0) * glint * 0.14 * water * (1.0 - fs * 0.5);
  float foam = smoothstep(0.4, 1.0, length(flowN)) * smoothstep(0.25, 0.8, fs);
  col = mix(col, vec3(0.93, 0.98, 1.0), foam * 0.32 * water);
  col += vec3(0.55, 0.9, 1.0) * ring * 0.18 * water;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** L3 + ember glow + L6 fog + L7 grade/vignette, straight to the screen. */
export const FRAG_COMPOSITE = `${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_fb;
uniform sampler2D u_masks;
uniform float u_time;
uniform vec4 u_embers[4]; // plate x, plate y, radius, intensity
uniform vec2 u_sun;       // plate coords, above the frame
uniform float u_shafts;
uniform float u_fog;
uniform float u_vig;
uniform float u_dim;
${PLATE}
${NOISE}
void main() {
  vec2 p = toPlate(v_uv);
  vec3 col = texture2D(u_fb, v_uv).rgb;
  vec3 m = texture2D(u_masks, p).rgb;
  float depth = texture2D(u_depth, p).r;
  float t = u_time;

  // light shafts: angular noise around a sun above the frame, gated by the light mask
  vec2 v = (p - u_sun) * vec2(PA, 1.0);
  float r = length(v);
  float ang = atan(v.x, v.y);
  float rays = vnoise(vec2(ang * 9.0 + t * 0.03, t * 0.02)) * 0.6
             + vnoise(vec2(ang * 23.0 - t * 0.045, 3.7 + t * 0.015)) * 0.4;
  rays = smoothstep(0.42, 0.95, rays);
  float pulse = 0.7 + 0.3 * sin(t * 0.68);
  float shaft = rays * smoothstep(1.7, 0.2, r) * smoothstep(0.95, 0.15, p.y)
              * (0.3 + 0.7 * m.b) * (1.0 - depth * 0.55);
  col += vec3(1.0, 0.94, 0.78) * shaft * 0.2 * pulse * u_shafts;

  // amber ember glows: slow pulse plus a little flicker
  for (int i = 0; i < 4; i++) {
    vec4 E = u_embers[i];
    vec2 dv = (p - E.xy) * vec2(PA, 1.0);
    float g = exp(-dot(dv, dv) / (E.z * E.z));
    float fi = float(i);
    float fl = 0.7 + 0.2 * sin(t * (1.1 + fi * 0.37) + fi * 2.1) + 0.12 * vnoise(vec2(t * 3.0, fi * 7.0));
    col += vec3(1.0, 0.5, 0.15) * g * E.w * fl;
  }

  // drifting mist: valley band in the far field plus a skin over the water
  float band = smoothstep(0.68, 0.25, depth) * smoothstep(0.12, 0.4, p.y) * smoothstep(0.78, 0.45, p.y);
  float fogMask = clamp(band + m.r * 0.45, 0.0, 1.0);
  vec2 fq = p * vec2(PA, 1.0) * vec2(2.0, 4.5);
  float f = vnoise(fq + vec2(t * 0.06, t * 0.012)) * 0.6 + vnoise(fq * 2.1 + vec2(-t * 0.04, 0.0)) * 0.4;
  float breath = 0.8 + 0.2 * sin(t * 0.24);
  col = mix(col, vec3(0.82, 0.9, 0.95), smoothstep(0.35, 0.95, f) * fogMask * u_fog * breath);

  // grade: lean shadows toward the site's teal/violet, then a little vibrance so the
  // water and the amber accents stay luminous under the page's readability veil
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, col * vec3(0.9, 0.97, 1.08), (1.0 - lum) * 0.3);
  lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = max(mix(vec3(lum), col, 1.12), 0.0);

  vec2 vv = (v_uv - 0.5) * vec2(1.0, 1.15);
  col *= mix(1.0, smoothstep(0.98, 0.22, length(vv)), u_vig);
  col *= 1.0 - u_dim;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** L4: soft additive sprites positioned in plate space so they follow parallax. */
export const VERT_PARTICLE = `
attribute vec2 a_corner;
attribute vec3 a_pos;   // plate x, plate y, depth
attribute float a_size; // clip-space half height
attribute vec4 a_color;
uniform vec4 u_view;
uniform vec2 u_par;
uniform float u_aspect;
varying vec4 v_color;
varying vec2 v_uv;
void main() {
  vec2 p = a_pos.xy - u_par * (a_pos.z - 0.5);
  vec2 s = (p - u_view.zw) / u_view.xy;
  vec2 clip = vec2(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0);
  clip += a_corner * a_size * vec2(1.0 / u_aspect, 1.0);
  v_uv = a_corner;
  v_color = a_color;
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

export const FRAG_PARTICLE = `
precision mediump float;
varying vec4 v_color;
varying vec2 v_uv;
void main() {
  float d2 = dot(v_uv, v_uv);
  float a = exp(-d2 * 4.5) + exp(-d2 * 40.0) * 0.6;
  gl_FragColor = vec4(v_color.rgb, v_color.a * a);
}
`;
