import type { Typology } from '@kubatur/core';
import type { Draft } from 'immer';

export interface NumericTypologyField {
  key: string;
  type: 'number';
  integer?: boolean;
  min?: number;
  get: (t: Typology) => number;
  set: (t: Draft<Typology>, v: number) => void;
}
export interface AlignmentField {
  key: 'alignment';
  type: 'alignment';
}
export interface ClosedField {
  key: 'closed';
  type: 'closed';
}
export type TypologyField = NumericTypologyField | AlignmentField | ClosedField;

function num<K extends string>(
  key: K,
  opts: { integer?: boolean; min?: number } = {},
): NumericTypologyField {
  return {
    key,
    type: 'number',
    ...opts,
    get: (t) => (t as unknown as Record<string, number>)[key] ?? 0,
    set: (t, v) => {
      (t as unknown as Record<string, number>)[key] = v;
    },
  };
}

/** Editable parameters per typology (options bar and properties palette). */
export function typologyFields(t: Typology): TypologyField[] {
  switch (t.kind) {
    case 'solitaer':
      return [num('length', { min: 1 }), num('depth', { min: 1 })];
    case 'zeile':
      return [
        num('length', { min: 1 }),
        num('depth', { min: 1 }),
        num('sections', { integer: true, min: 1 }),
        num('sectionOffset'),
      ];
    case 'reihe':
      return [
        num('count', { integer: true, min: 1 }),
        num('unitWidth', { min: 1 }),
        num('depth', { min: 1 }),
        num('alternatingOffset'),
      ];
    case 'freeLine':
      return [
        num('depth', { min: 1 }),
        { key: 'alignment', type: 'alignment' },
        { key: 'closed', type: 'closed' },
      ];
    case 'freePolygon':
      return [];
  }
}
