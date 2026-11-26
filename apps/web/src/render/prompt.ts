import {
  resolveOutdoor,
  type Mass,
  type OutdoorKind,
  type Project,
  type RoofKind,
  type Usage,
} from '@kubatur/core';
import type { SceneLook } from '../viewport/scene/looks';

/**
 * Prompt for the AI rendering of the 3D view, built from the project. Image models follow English
 * best, so the prompt is English; the user can edit it before sending.
 */

export type RenderStyle = 'photo' | 'golden' | 'overcast' | 'dusk' | 'aquarelle' | 'maquette';
export const RENDER_STYLES: readonly RenderStyle[] = [
  'photo',
  'golden',
  'overcast',
  'dusk',
  'aquarelle',
  'maquette',
];

export type FacadeMaterial = 'auto' | 'enduit' | 'brique' | 'bois' | 'beton' | 'pierre' | 'metal';
export const FACADE_MATERIALS: readonly FacadeMaterial[] = [
  'auto',
  'enduit',
  'brique',
  'bois',
  'beton',
  'pierre',
  'metal',
];

export interface PromptOptions {
  style: RenderStyle;
  material: FacadeMaterial;
  /** Trees, people, cars in the scene. */
  animate: boolean;
  /** Current ambiance of the 3D view (tells the model what the screenshot shows). */
  look: SceneLook;
  colourCoded?: boolean;
  /** 0–1: how strictly the result keeps the view (wording of the constraints). */
  fidelity?: number;
  /** A line drawing of the view is sent as second image. */
  guide?: boolean;
}

const STYLE_TEXT: Record<RenderStyle, string> = {
  photo:
    'Photorealistic architectural photograph, bright sunny day, clear blue sky with a few clouds, natural soft shadows.',
  golden:
    'Photorealistic architectural photograph at golden hour, warm low sun, long soft shadows, glowing sky.',
  overcast:
    'Photorealistic architectural photograph under a soft overcast sky, diffuse light, calm muted colours.',
  dusk: 'Photorealistic architectural photograph at blue hour, deep blue sky, warm light glowing from the windows.',
  aquarelle:
    'Hand-drawn architectural illustration, fine ink lines with soft watercolour washes, white paper background, competition sketch style.',
  maquette:
    'Photograph of a refined physical architectural model, white card and light wood, on a model base, studio lighting, shallow depth of field.',
};

const MATERIAL_TEXT: Record<Exclude<FacadeMaterial, 'auto'>, string> = {
  enduit: 'light mineral render (off-white plaster) façades',
  brique: 'warm red-brown brick façades',
  bois: 'vertical timber cladding façades',
  beton: 'fine architectural concrete façades',
  pierre: 'light limestone façades',
  metal: 'anodised metal and glass façades',
};

const USAGE_TEXT: Record<Usage, string> = {
  wohnen: 'residential apartments',
  wohnheim: 'a residence (student or senior housing)',
  buero: 'offices',
  gewerbe: 'shops and commercial space',
  gemeinbedarf: 'a public facility',
  parken: 'parking',
  technik: 'technical rooms',
};

const ROOF_TEXT: Record<RoofKind, string> = {
  flat: 'flat roofs with parapets',
  shed: 'mono-pitched roofs',
  gable: 'gabled pitched roofs',
  hip: 'hipped roofs',
};

const LOOK_TEXT: Record<SceneLook, string> = {
  maquette: 'an abstract white massing model',
  bois: 'an abstract wooden massing model',
  diagramme: 'an abstract diagrammatic massing model',
};

function usageAt(m: Mass, index: number): Usage {
  return m.usageByStorey?.[index] ?? (index < 0 ? 'parken' : (m.usage ?? 'wohnen'));
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Facts about the active variant that matter for an image (counts, uses, roofs, outdoor). */
export function describeProject(project: Project) {
  const variant = project.variants.find((v) => v.id === project.activeVariantId);
  const masses = variant?.masses ?? [];
  const uses = new Set<Usage>();
  const groundUses = new Set<Usage>();
  const roofs = new Set<RoofKind>();
  const outdoor = new Set<OutdoorKind>();
  let maxUpper = 0;
  let minUpper = Infinity;
  let setback = false;
  let terraces = false;
  for (const m of masses) {
    const upper = m.storeys.upper.count;
    maxUpper = Math.max(maxUpper, upper);
    minUpper = Math.min(minUpper, upper);
    groundUses.add(usageAt(m, 0));
    for (let i = 1; i <= upper; i++) uses.add(usageAt(m, i));
    if (upper === 0) uses.add(usageAt(m, 0));
    roofs.add(m.roof?.kind ?? 'flat');
    const o = resolveOutdoor(m, project.settings);
    outdoor.add(o.kind);
    for (const side of Object.values(o.sides ?? {})) if (side) outdoor.add(side.kind);
    if (m.storeys.setback?.storeys) setback = true;
    if (m.storeys.terraces?.length) terraces = true;
  }
  const residential = uses.has('wohnen') || uses.has('wohnheim');
  outdoor.delete('none');
  return {
    count: masses.length,
    maxUpper,
    minUpper: Number.isFinite(minUpper) ? minUpper : 0,
    uses: [...uses],
    groundUses: [...groundUses],
    roofs: [...roofs],
    outdoor: residential ? [...outdoor] : [],
    setback,
    terraces,
    trees: project.surroundings?.trees.length ?? 0,
    neighbours: project.context.length,
    city: cityOf(project.info.address),
  };
}

/** "27 Bd Thomas Gobert, 91120 Palaiseau" → "Palaiseau". */
export function cityOf(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const m = /\b\d{5}\s+([^,]+)/.exec(address);
  return (m?.[1] ?? address.split(',').pop())?.trim() || undefined;
}

function defaultMaterial(uses: Usage[]): string {
  if (uses.includes('buero') && !uses.includes('wohnen'))
    return 'light stone and glass façades with a regular grid of large office windows';
  return 'light mineral render façades with accents of brick and wood, regular vertical French windows with thin metal railings';
}

/**
 * The prompt is an edit instruction, not a scene description: image models otherwise "re-shoot"
 * the scene (camera pulled back, whole buildings shown, extra floors). Storey counts are left out
 * on purpose: the view is often cropped, and a number makes the model add the missing floors.
 */
export function buildPrompt(project: Project, o: PromptOptions): string {
  const d = describeProject(project);
  const fidelity = o.fidelity ?? 0.85;
  const sketch = o.style === 'aquarelle' || o.style === 'maquette';
  const src = o.colourCoded ? 'an abstract colour-coded massing model' : LOOK_TEXT[o.look];
  const lines: string[] = [];
  lines.push(
    `Edit this image. It is a screenshot of ${src} seen from a fixed camera. ` +
      `Turn it into: ${STYLE_TEXT[o.style]}` +
      (sketch ? '' : ' High-end architectural visualisation, realistic materials, sharp details.'),
  );
  const keep = [
    'Keep the exact composition of the input image: same camera position, height, direction and focal length, same framing. Do not zoom out, do not move, tilt or rotate the camera.',
    'Every building edge, floor line, opening, balcony and roof line stays exactly where it is in the image.',
    'Buildings cut off by the image border stay cut off; do not reveal roofs, floors or anything else outside the frame.',
    'Keep the number of floors, the building heights and the street width as shown; do not add buildings, floors or storeys.',
  ];
  if (fidelity >= 0.85) keep.push('Do not add new objects in front of the buildings.');
  if (fidelity < 0.5) keep.push('Small deviations in details are acceptable.');
  lines.push(keep.join(' '));
  if (o.guide)
    lines.push(
      'The second image is a line drawing of the first one at the same size: all edges of the result must lie exactly on these lines.',
    );
  if (!sketch) lines.push('Replace the abstract model surfaces with real building materials.');
  if (d.count) {
    let use = `Use: ${list(d.uses.map((u) => USAGE_TEXT[u]))}`;
    const ground = d.groundUses.filter((u) => !d.uses.includes(u));
    if (ground.length)
      use += `, with ${list(ground.map((u) => USAGE_TEXT[u]))} on the ground floor`;
    lines.push(`${use}.`);
    const shape: string[] = [];
    if (d.outdoor.includes('balcon')) shape.push('balconies');
    if (d.outdoor.includes('loggia')) shape.push('recessed loggias');
    const roofs = list(d.roofs.map((r) => ROOF_TEXT[r]));
    lines.push(
      `Architecture: contemporary French architecture, ${roofs} where visible` +
        `${shape.length ? `; the openings in the model are ${list(shape)}` : ''}.`,
    );
  }
  lines.push(
    `Façades: ${o.material === 'auto' ? defaultMaterial(d.uses) : MATERIAL_TEXT[o.material]}.`,
  );
  const ctx: string[] = [d.city ? `${d.city}, France` : 'a French town'];
  if (d.neighbours) ctx.push('neighbouring buildings kept simple and in neutral tones');
  if (o.animate && fidelity < 0.95)
    ctx.push(
      'a few small pedestrians and some planting on the open ground only, never covering the façades',
    );
  lines.push(`Context: ${ctx.join('; ')}.`);
  return lines.join('\n');
}

export const NEGATIVE_PROMPT =
  'changed camera angle, zoomed out view, wider street, extra floors, extra buildings, distorted geometry, warped or curved walls, text, labels, watermark, logo, cartoon, blurry, low resolution';
