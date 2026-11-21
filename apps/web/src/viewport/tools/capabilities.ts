import type { ToolKind } from '../../store/tools';

/**
 * Tools that are fully implemented in the viewport. The ribbon enables a command only if its tool
 * is listed here; all others are shown disabled with "en préparation" (no silent stubs).
 */
export const IMPLEMENTED_TOOLS: readonly ToolKind[] = [
  'select',
  'place',
  'move',
  'copy',
  'rotate',
  'mirror',
  'array',
];
