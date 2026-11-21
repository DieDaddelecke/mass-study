import { analyzeProject, type ProjectAnalysis } from '@kubatur/core';
import { useMemo } from 'react';
import { useProjectStore } from './projectStore';

/**
 * Live analysis of the active variant. Synchronous for now (well below 50 ms for typical models);
 * moves to a Web Worker (Comlink) in a later phase if needed.
 */
export function useAnalysis(): ProjectAnalysis | null {
  const project = useProjectStore((s) => s.project);
  return useMemo(() => {
    if (!project) return null;
    try {
      return analyzeProject(project);
    } catch (e) {
      console.error('analysis failed', e);
      return null;
    }
  }, [project]);
}
