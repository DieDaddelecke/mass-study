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

export function buildPrompt(project: Project, o: PromptOptions): string {
  const d = describeProject(project);
  const lines: string[] = [];
  const sketch = o.style === 'aquarelle' || o.style === 'maquette';
  lines.push(
    sketch
      ? STYLE_TEXT[o.style]
      : `${STYLE_TEXT[o.style]} High-end architectural visualisation, realistic materials, sharp details.`,
  );
  const src = o.colourCoded ? 'an abstract colour-coded massing model' : LOOK_TEXT[o.look];
  lines.push(
    `The input image is ${src}. Keep the exact building volumes, footprints, number of floors, roof shapes, ` +
      'camera position and perspective unchanged. Do not add or remove floors or buildings. ' +
      (sketch ? '' : 'Replace the abstract model surfaces with real building materials.'),
  );
  if (d.count) {
    const storeys =
      d.minUpper === d.maxUpper
        ? `${d.maxUpper + 1} storeys (R+${d.maxUpper})`
        : `${d.minUpper + 1} to ${d.maxUpper + 1} storeys (R+${d.minUpper} to R+${d.maxUpper})`;
    const n = d.count > 1 ? `${d.count} buildings` : 'one building';
    let prog = `Programme: ${n}, ${storeys}, ${list(d.uses.map((u) => USAGE_TEXT[u]))}`;
    const ground = d.groundUses.filter((u) => !d.uses.includes(u));
    if (ground.length)
      prog += `, with ${list(ground.map((u) => USAGE_TEXT[u]))} on the ground floor`;
    lines.push(`${prog}.`);
    const shape: string[] = [list(d.roofs.map((r) => ROOF_TEXT[r]))];
    if (d.setback) shape.push('a set-back top floor (attic storey) with a terrace');
    if (d.terraces) shape.push('stepped roof terraces');
    if (d.outdoor.includes('balcon')) shape.push('balconies');
    if (d.outdoor.includes('loggia')) shape.push('recessed loggias');
    lines.push(`Architecture: contemporary French architecture, ${list(shape)}.`);
  }
  lines.push(
    `Façades: ${o.material === 'auto' ? defaultMaterial(d.uses) : MATERIAL_TEXT[o.material]}.`,
  );
  const ctx: string[] = [d.city ? `${d.city}, France` : 'a French town'];
  if (d.neighbours) ctx.push('existing neighbouring buildings kept simple and in neutral tones');
  if (o.animate)
    ctx.push(
      d.trees ? 'mature street trees, landscaped gardens' : 'landscaped gardens and young trees',
      'a few pedestrians and cyclists',
    );
  lines.push(`Context: ${ctx.join('; ')}.`);
  return lines.join('\n');
}

export const NEGATIVE_PROMPT =
  'distorted geometry, extra floors, warped or curved walls, changed camera angle, text, labels, watermark, logo, cartoon, blurry, low resolution';
