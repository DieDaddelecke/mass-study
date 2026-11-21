/**
 * Minimal ISO 10303-21 (STEP physical file) writer.
 *
 * Attribute values are passed as already encoded STEP tokens (strings). Use the helpers below
 * to build them – never pass user text directly, always wrap it with {@link str}.
 *
 * ```ts
 * const w = new StepWriter();
 * const p = w.add('IFCCARTESIANPOINT', [list([real(0), real(0), real(0)])]);
 * w.add('IFCAXIS2PLACEMENT3D', [p, NULL, NULL]); // p is already the token "#1"
 * const text = w.toString({ description: 'ViewDefinition [ReferenceView_V1.2]', ... });
 * ```
 */

/** An encoded STEP token, e.g. `#12`, `'abc'`, `.T.`, `3.5`, `(#1,#2)`. */
export type StepToken = string;

export const NULL: StepToken = '$';
export const DERIVED: StepToken = '*';

/** Entity reference token (`#n`). */
export type StepRef = `#${number}`;

/** Encode a string as a STEP string literal (ISO 10303-21: `''`, `\\`, `\X2\…\X0\`). */
export function str(s: string | undefined | null): StepToken {
  if (s == null) return NULL;
  let out = '';
  let wide = '';
  const flush = () => {
    if (wide) out += `\\X2\\${wide}\\X0\\`;
    wide = '';
  };
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i); // UTF-16 code units, as required by \X2\
    if (code >= 0x20 && code <= 0x7e) {
      flush();
      const ch = s[i]!;
      out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch;
    } else {
      wide += code.toString(16).toUpperCase().padStart(4, '0');
    }
  }
  flush();
  return `'${out}'`;
}

/** Decode a STEP string literal produced by {@link str} (used in tests). */
export function decodeStr(token: string): string {
  const body = token.slice(1, -1).replace(/''/g, "'");
  return body
    .replace(/\\X2\\([0-9A-F]*)\\X0\\/g, (_, hex: string) =>
      String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16))),
    )
    .replace(/\\\\/g, '\\');
}

/** STEP REAL: always contains a decimal point; exponent with `E`. */
export function real(n: number): StepToken {
  if (!Number.isFinite(n)) throw new Error(`Non-finite real in STEP output: ${n}`);
  const r = Math.abs(n) < 1e-12 ? 0 : Number(n.toPrecision(15));
  const s = String(r).toUpperCase();
  const [mant, exp] = s.split('E') as [string, string | undefined];
  const m = mant.includes('.') ? mant : `${mant}.`;
  return exp !== undefined ? `${m}E${exp}` : m;
}

export function int(n: number): StepToken {
  return String(Math.round(n));
}

export function enumv(v: string): StepToken {
  return `.${v.toUpperCase()}.`;
}

export function bool(b: boolean): StepToken {
  return b ? '.T.' : '.F.';
}

export function list(items: readonly StepToken[]): StepToken {
  return `(${items.join(',')})`;
}

/** Typed value for SELECT attributes, e.g. `IFCLABEL('x')`. */
export function typed(type: string, value: StepToken): StepToken {
  return `${type.toUpperCase()}(${value})`;
}

export interface StepHeader {
  description: string[];
  implementationLevel?: string;
  name: string;
  timeStamp: string;
  author?: string[];
  organization?: string[];
  preprocessorVersion: string;
  originatingSystem: string;
  authorization?: string;
  schema: string;
}

export class StepWriter {
  private readonly lines: string[] = [];

  /** Append an entity instance and return its reference. */
  add(type: string, args: readonly StepToken[]): StepRef {
    const id = this.lines.length + 1;
    this.lines.push(`#${id}=${type.toUpperCase()}(${args.join(',')});`);
    return `#${id}`;
  }

  get count(): number {
    return this.lines.length;
  }

  toString(h: StepHeader): string {
    const strList = (xs: string[] | undefined) => list((xs?.length ? xs : ['']).map(str));
    return [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_DESCRIPTION(${strList(h.description)},${str(h.implementationLevel ?? '2;1')});`,
      `FILE_NAME(${[
        str(h.name),
        str(h.timeStamp),
        strList(h.author),
        strList(h.organization),
        str(h.preprocessorVersion),
        str(h.originatingSystem),
        str(h.authorization ?? ''),
      ].join(',')});`,
      `FILE_SCHEMA((${str(h.schema)}));`,
      'ENDSEC;',
      'DATA;',
      ...this.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }
}
