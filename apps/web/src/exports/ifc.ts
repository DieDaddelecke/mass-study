import { analyzeProject, USAGES, type Project, type TypologyKind } from '@kubatur/core';
import type { IfcExportOptions, IfcLabels } from '@kubatur/ifc';
import i18n from '../i18n';
import { downloadBlob, safeFileName } from './download';

export type IfcExportFlags = Required<
  Pick<IfcExportOptions, 'spaces' | 'slabs' | 'massProxies' | 'context'>
>;

/** Archicad-friendly defaults (§14 A): spaces → zones, slabs on, proxies and context off. */
export const IFC_ARCHICAD_DEFAULTS: IfcExportFlags = {
  spaces: true,
  slabs: true,
  massProxies: false,
  context: false,
};

const TYPOLOGIES: TypologyKind[] = ['solitaer', 'zeile', 'reihe', 'freeLine', 'freePolygon'];

/** Texts written into the IFC file, in the current UI language. */
export function ifcLabels(): IfcLabels {
  const t = i18n.getFixedT(null, 'exports');
  const c = i18n.getFixedT(null, 'common');
  return {
    building: t('ifc.building'),
    site: t('ifc.site'),
    slab: t('ifc.slab'),
    context: t('ifc.contextBuilding'),
    usage: Object.fromEntries(USAGES.map((u) => [u, c(`usage.${u}`)])) as IfcLabels['usage'],
    typology: Object.fromEntries(
      TYPOLOGIES.map((k) => [k, c(`typology.${k}`)]),
    ) as IfcLabels['typology'],
  };
}

/** Export the active variant as `<project>.ifc`. The writer is loaded on demand. */
export async function exportActiveVariantIfc(
  project: Project,
  flags: IfcExportFlags = IFC_ARCHICAD_DEFAULTS,
): Promise<void> {
  const { exportIfc } = await import('@kubatur/ifc');
  const { result } = analyzeProject(project);
  const text = exportIfc(project, result, {
    ...flags,
    labels: ifcLabels(),
    guidSeed: `${project.id}:${project.activeVariantId}`,
  });
  downloadBlob(
    new Blob([text], { type: 'application/x-step' }),
    `${safeFileName(project.name)}.ifc`,
  );
}
