import { parseProject, serializeProject, type Project } from '@kubatur/core';

export const FILE_SUFFIX = '.massing.json';

/** File name for a project: unsafe characters replaced, `.massing.json` appended. */
export function projectFileName(name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'projet';
  return base.endsWith(FILE_SUFFIX) ? base : base + FILE_SUFFIX;
}

/** Trigger a browser download of the project file. */
export function downloadProject(p: Project, name: string = p.name): void {
  const blob = new Blob([serializeProject(p)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = projectFileName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read and validate a project file. Rejects with a descriptive error for invalid files. */
export async function readProjectFile(file: Blob): Promise<Project> {
  const text = await file.text();
  return parseProject(text);
}

/** Open a file picker and resolve with the chosen file (null if cancelled). */
export function pickFile(accept = '.json,.massing.json,application/json'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
