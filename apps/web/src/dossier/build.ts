import {
  analyzeProject,
  calculationSchedule,
  kpiSchedule,
  surfacesSchedule,
  typologySchedule,
  type Project,
} from '@kubatur/core';
import i18n, { formatNumber } from '../i18n';
import {
  composeDossier,
  DEFAULT_OPTIONS,
  type DossierInput,
  type DossierOptions,
  type Sheet,
} from './sheets';

export interface BuildExtras {
  logo?: string;
  coverImage?: DossierInput['coverImage'];
  views?: DossierInput['views'];
}

/** Compose the dossier of one variant in the current UI language. */
export function buildDossier(
  project: Project,
  variantId: string,
  opts: DossierOptions = DEFAULT_OPTIONS,
  extras: BuildExtras = {},
): Sheet[] {
  const analysis = analyzeProject(project, variantId);
  const so = { variantIds: [variantId], analyses: new Map([[variantId, analysis]]) };
  const t = i18n.getFixedT(null, 'dossier');
  return composeDossier(
    {
      project,
      analysis,
      variantName: project.variants.find((v) => v.id === variantId)?.name ?? '',
      schedules: [
        surfacesSchedule(project, so),
        kpiSchedule(project, so),
        typologySchedule(project, so),
        calculationSchedule(project, so),
      ],
      t: (k, p) => t(k, p ?? {}),
      formatNumber: (v, d) => formatNumber(v, d),
      ...extras,
    },
    opts,
  );
}
