import { useEffect } from 'react';
import { escape, redo, save, TWO_LETTER, undo, deleteSelection } from './commands';

export const SEQUENCE_TIMEOUT = 1000;

/**
 * Two-letter command parser: feed it letters with timestamps; it returns the command when the
 * last two letters (typed within `timeout` ms) form a known code.
 */
export function createSequenceParser(codes: readonly string[], timeout = SEQUENCE_TIMEOUT) {
  let buf = '';
  let last = -Infinity;
  return {
    push(key: string, time: number): string | null {
      if (!/^[a-z]$/i.test(key)) {
        buf = '';
        return null;
      }
      if (time - last > timeout) buf = '';
      last = time;
      buf = (buf + key.toUpperCase()).slice(-2);
      if (buf.length === 2 && codes.includes(buf)) {
        const code = buf;
        buf = '';
        return code;
      }
      return null;
    },
    reset() {
      buf = '';
    },
  };
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
  );
}

/** Install the global keyboard shortcuts (Ctrl+Z/Y/S, Delete, Esc, two-letter commands). */
export function useShortcuts(): void {
  useEffect(() => {
    const parser = createSequenceParser(Object.keys(TWO_LETTER));
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (mod) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
          e.preventDefault();
          redo();
        }
        return;
      }
      if (e.altKey) return;
      if (e.key === 'Escape') {
        parser.reset();
        escape();
        return;
      }
      if (e.key === 'Delete') {
        deleteSelection();
        return;
      }
      const cmd = parser.push(e.key, e.timeStamp || performance.now());
      if (cmd) TWO_LETTER[cmd]?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
