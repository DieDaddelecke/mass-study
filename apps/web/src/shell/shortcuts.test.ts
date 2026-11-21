import { describe, expect, it } from 'vitest';
import { createSequenceParser, isTypingTarget } from './shortcuts';

describe('two-letter shortcut parser', () => {
  const codes = ['MV', 'RO', 'DE', 'ZF'];

  it('recognises a code typed within the timeout', () => {
    const p = createSequenceParser(codes, 1000);
    expect(p.push('m', 0)).toBeNull();
    expect(p.push('v', 300)).toBe('MV');
  });

  it('ignores letters that are too far apart', () => {
    const p = createSequenceParser(codes, 1000);
    p.push('z', 0);
    expect(p.push('f', 1500)).toBeNull();
    expect(p.push('z', 1600)).toBeNull();
    expect(p.push('f', 1700)).toBe('ZF');
  });

  it('uses a sliding window and resets after a match', () => {
    const p = createSequenceParser(codes, 1000);
    p.push('x', 0);
    p.push('r', 100);
    expect(p.push('o', 200)).toBe('RO');
    expect(p.push('o', 300)).toBeNull();
  });

  it('resets on non-letter keys', () => {
    const p = createSequenceParser(codes, 1000);
    p.push('d', 0);
    expect(p.push('Shift', 50)).toBeNull();
    expect(p.push('e', 100)).toBeNull();
  });

  it('detects typing targets', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
  });
});
