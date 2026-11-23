import {
  Color,
  DoubleSide,
  MeshStandardMaterial,
  Vector2,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { Polygon } from '@kubatur/core';

/**
 * Materials of the physical architecture model look ("Maquette bois"): solid wood blocks and
 * cast plaster. The textures are procedural *solid* textures evaluated per fragment in world
 * space, so they need no UVs and stay continuous across the storeys of a mass:
 *
 * - wood: annual rings around a "log" axis that runs along the length of the block. Side and top
 *   faces show long grain along the block, the gable ends show the end grain (ring arcs), as on a
 *   block cut from a plank. Fine fibres, slow colour variation and a subtle bump (relief of the
 *   rings and pores) come from the same function; the roughness follows the grain.
 * - plaster: off-white cast with fine pores and a little mottling.
 *
 * Details finer than a pixel fade out (screen-space derivatives), so distant views stay calm
 * instead of flickering. The shader code is shared (one program per material kind); each mass only
 * brings its own uniforms (grain direction, species colours, seed).
 */

export interface WoodSpecies {
  /** Earlywood (light) and latewood (dark) colours, sRGB. */
  light: string;
  dark: string;
}

/** Woods of the model, by mass order: walnut first, then pale pear, dark walnut, oak. */
export const WOOD_SPECIES: readonly WoodSpecies[] = [
  { light: '#8d6c55', dark: '#4d372b' },
  { light: '#cfa898', dark: '#a37f74' },
  { light: '#6b4f40', dark: '#3a2a22' },
  { light: '#cba57a', dark: '#94724c' },
];

const NOISE = /* glsl */ `
float mmHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float mmNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(mmHash(i), mmHash(i + vec3(1, 0, 0)), f.x),
        mix(mmHash(i + vec3(0, 1, 0)), mmHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(mmHash(i + vec3(0, 0, 1)), mmHash(i + vec3(1, 0, 1)), f.x),
        mix(mmHash(i + vec3(0, 1, 1)), mmHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Bump mapping from a height value (as three's perturbNormalArb, without a texture).
vec3 mmBump(vec3 n, float h, float scale, vec3 viewPos, float faceDir) {
  vec3 sx = dFdx(-viewPos);
  vec3 sy = dFdy(-viewPos);
  float dhx = dFdx(h) * scale;
  float dhy = dFdy(h) * scale;
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - grad);
}
`;

const VERT_HEAD = /* glsl */ `
varying vec3 vMmPos;
varying vec3 vMmNormal;
void main() {`;

const VERT_BODY = /* glsl */ `#include <project_vertex>
  vMmPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vMmNormal = normalize(mat3(modelMatrix) * objectNormal);`;

const WOOD_FRAG_HEAD = /* glsl */ `
varying vec3 vMmPos;
varying vec3 vMmNormal;
uniform vec2 uGrainDir;
uniform vec2 uOrigin;
uniform vec2 uLogCentre;
uniform float uSeed;
uniform vec3 uLight;
uniform vec3 uDark;
${NOISE}
// rgb = colour (linear), w = relief height (0 … 1)
vec4 mmWood(out float rough) {
  vec2 d = uGrainDir;
  vec2 rel = vMmPos.xy - uOrigin;
  // block frame: a along the grain (length of the block), b across, c up
  vec3 q = vec3(dot(rel, d), dot(rel, vec2(-d.y, d.x)), vMmPos.z);
  vec3 s = vec3(uSeed * 7.31, uSeed * 3.17, uSeed * 5.13);
  float fw = length(fwidth(q));
  // annual rings around a log axis along a, wobbling slowly along the grain
  float wob = mmNoise(vec3(q.x * 0.022, q.y * 0.07, q.z * 0.07) + s) * 2.4
            + mmNoise(vec3(q.x * 0.05, q.y * 0.4, q.z * 0.4) + s.zxy) * 0.18;
  float r = length(q.yz - uLogCentre) + wob;
  // irregular ring widths (good and bad growth years)
  float t = fract(r / 0.5 + 0.8 * mmNoise(vec3(r * 0.9, s.x, s.y)));
  // earlywood → latewood: gradual darkening, sharp boundary to the next ring
  float ring = smoothstep(0.45, 0.9, t) * (1.0 - smoothstep(0.9, 1.0, t));
  ring = mix(ring, 0.3, smoothstep(0.12, 0.45, fw));
  // fibres and pore streaks, long along the grain
  float fib = mmNoise(vec3(q.x * 0.25, q.y * 6.0, q.z * 6.0) + s.yzx);
  fib = smoothstep(0.5, 0.95, fib) * 0.7
      + smoothstep(0.75, 0.95, mmNoise(vec3(q.x * 0.9, q.y * 18.0, q.z * 18.0) + s)) * 0.5;
  fib *= 1.0 - smoothstep(0.03, 0.12, fw);
  // slow colour variation inside the block
  float tone = mmNoise(q * vec3(0.02, 0.09, 0.09) + s.zyx);
  vec3 col = mix(uLight, uDark, clamp(ring * 0.6 + fib * 0.3, 0.0, 1.0));
  col *= 0.93 + 0.14 * tone;
  // end grain (gable ends) absorbs more light: a little darker and duller
  float endGrain = abs(dot(normalize(vMmNormal.xy + 1e-5), d)) * (1.0 - abs(vMmNormal.z));
  col *= 1.0 - 0.18 * smoothstep(0.6, 0.95, endGrain);
  rough = 0.62 + 0.18 * ring + 0.12 * endGrain;
  return vec4(col, ring * 0.7 + fib * 0.3);
}
float mmHeight;
float mmRough;`;

const PLASTER_FRAG_HEAD = /* glsl */ `
varying vec3 vMmPos;
varying vec3 vMmNormal;
uniform vec3 uBase;
${NOISE}
vec4 mmPlaster() {
  vec3 p = vMmPos;
  float fw = length(fwidth(p));
  // pores: small dark pits, sparse
  float pore = smoothstep(0.8, 0.88, mmNoise(p * 7.0 + 11.0));
  pore *= 1.0 - smoothstep(0.02, 0.07, fw);
  // larger air bubbles of the cast, still visible from further away
  float bubble = smoothstep(0.86, 0.92, mmNoise(p * 1.6 + 5.0));
  bubble *= 1.0 - smoothstep(0.08, 0.25, fw);
  pore = max(pore, bubble * 0.8);
  float grain = mmNoise(p * 19.0) - 0.5;
  grain *= 1.0 - smoothstep(0.008, 0.03, fw);
  float mottle = mmNoise(p * 0.18 + 3.0);
  vec3 col = uBase * (0.95 + 0.06 * mottle + 0.05 * grain) * (1.0 - 0.3 * pore);
  return vec4(col, 1.0 - pore + 0.15 * grain);
}
float mmHeight;`;

const FACE_DIR = /* glsl */ `(gl_FrontFacing ? 1.0 : -1.0)`;

function patch(
  shader: WebGLProgramParametersWithUniforms,
  fragHead: string,
  color: string,
  rough: string,
  bump: number,
) {
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', VERT_HEAD)
    .replace('#include <project_vertex>', VERT_BODY);
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `${fragHead}\nvoid main() {`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${color}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${rough}`)
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      normal = mmBump(normal, mmHeight, ${bump.toFixed(4)}, vViewPosition, ${FACE_DIR});`,
    );
}

export interface WoodBlock {
  /** Grain direction in plan (unit vector): the long direction of the block. */
  dir: readonly [number, number];
  /** A point of the block (frame origin). */
  origin: readonly [number, number];
  species: WoodSpecies;
  /** Varies ring position and noise between blocks. */
  seed: number;
}

interface WoodUniforms {
  uGrainDir: { value: Vector2 };
  uOrigin: { value: Vector2 };
  uLogCentre: { value: Vector2 };
  uSeed: { value: number };
  uLight: { value: Color };
  uDark: { value: Color };
}

/** Wood material of one block (mass); `updateWood` adapts it when the block moves or turns. */
export function woodMaterial(b: WoodBlock): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    roughness: 0.7,
    metalness: 0,
    // also the roof faces, which are drawn double-sided
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const uniforms: WoodUniforms = {
    uGrainDir: { value: new Vector2() },
    uOrigin: { value: new Vector2() },
    uLogCentre: { value: new Vector2() },
    uSeed: { value: 0 },
    uLight: { value: new Color() },
    uDark: { value: new Color() },
  };
  m.userData.wood = uniforms;
  updateWood(m, b);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patch(
      shader,
      WOOD_FRAG_HEAD,
      `vec4 mmW = mmWood(mmRough); diffuseColor.rgb = mmW.rgb; mmHeight = mmW.w;`,
      `roughnessFactor = mmRough;`,
      0.012,
    );
  };
  m.customProgramCacheKey = () => 'maquette-wood';
  return m;
}

export function updateWood(m: MeshStandardMaterial, b: WoodBlock) {
  const u = m.userData.wood as WoodUniforms;
  const s = b.seed;
  u.uGrainDir.value.set(b.dir[0], b.dir[1]);
  u.uOrigin.value.set(b.origin[0], b.origin[1]);
  // log axis just beside the block (rift-sawn): straight lines along the sides and the top,
  // clear ring arcs on the gable ends
  const side = s % 2 ? 1 : -1;
  u.uLogCentre.value.set(side * (9 + ((s * 3.7) % 6)), 4 + ((s * 5.3) % 9));
  u.uSeed.value = (s % 97) + 0.5;
  u.uLight.value.set(b.species.light);
  u.uDark.value.set(b.species.dark);
}

/** Cast plaster / concrete (neighbouring buildings). */
export function plasterMaterial(color: string): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    roughness: 0.95,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const uniforms = { uBase: { value: new Color(color) } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patch(
      shader,
      PLASTER_FRAG_HEAD,
      `vec4 mmP = mmPlaster(); diffuseColor.rgb = mmP.rgb; mmHeight = mmP.w;`,
      '',
      0.004,
    );
  };
  m.customProgramCacheKey = () => 'maquette-plaster';
  return m;
}

/**
 * Grain direction of a block: along the longest edge of its largest footprint (a model maker
 * cuts the block from a plank with the grain along its length).
 */
export function grainFrame(footprints: readonly Polygon[]): Pick<WoodBlock, 'dir' | 'origin'> {
  let best: Polygon | null = null;
  let bestArea = -1;
  for (const p of footprints) {
    const r = p.outer;
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const [x0, y0] = r[i]!;
      const [x1, y1] = r[(i + 1) % r.length]!;
      a += x0 * y1 - x1 * y0;
    }
    if (Math.abs(a) > bestArea) {
      bestArea = Math.abs(a);
      best = p;
    }
  }
  const r = best?.outer ?? [];
  let dir: [number, number] = [1, 0];
  let len = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i]!;
    const [x1, y1] = r[(i + 1) % r.length]!;
    cx += x0;
    cy += y0;
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (l > len) {
      len = l;
      dir = [(x1 - x0) / l, (y1 - y0) / l];
    }
  }
  const n = Math.max(1, r.length);
  return { dir, origin: [cx / n, cy / n] };
}
