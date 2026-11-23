import { analyzeProject, type ProjectAnalysis } from '@kubatur/core';
import { useProjectStore } from './projectStore';
import type { Project } from '@kubatur/core';

/**
 * One analysis per project state, shared by every component (KPI bar, inspector, 3D view,
 * tables, …). Before, each component ran its own `analyzeProject` (incl. the dwelling layouts),
 * i.e. the same work 5–7 times per edit. The core additionally memoizes per mass, so editing one
 * mass only re-analyses that mass.
 */
const cache = new WeakMap<Project, ProjectAnalysis | null>();

export function analysisOf(project: Project | null): ProjectAnalysis | null {
  if (!project) return null;
  if (cache.has(project)) return cache.get(project)!;
  let a: ProjectAnalysis | null;
  try {
    a = analyzeProject(project);
  } catch (e) {
    console.error('analysis failed', e);
    a = null;
  }
  cache.set(project, a);
  return a;
}

/** Live analysis of the active variant (synchronous, cached per project state). */
export function useAnalysis(): ProjectAnalysis | null {
  return analysisOf(useProjectStore((s) => s.project));
}
