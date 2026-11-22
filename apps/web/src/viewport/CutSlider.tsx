import { X } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Vertical storey slider of the storey cut (right edge of the 3D view): one stop per storey, the
 * highest on top. Click or drag along the track, mouse wheel, arrow keys / Page Up / Page Down.
 * With `withRoof` (plan view) a first stop "Toiture" stands for the uncut model seen from above
 * (value null) and the slider cannot be closed.
 */
export function CutSlider({
  levels,
  labelOf,
  value,
  onChange,
  onClose,
  withRoof = false,
}: {
  /** Storey indices, highest first. */
  levels: readonly number[];
  labelOf: (level: number) => string;
  value: number | null;
  onChange: (level: number | null) => void;
  onClose?: () => void;
  withRoof?: boolean;
}) {
  const { t } = useTranslation('viewport');
  const track = useRef<HTMLDivElement>(null);
  const stops: readonly (number | null)[] = withRoof ? [null, ...levels] : levels;
  const i = Math.max(0, stops.indexOf(value));
  const step = (d: number) => {
    const j = Math.min(stops.length - 1, Math.max(0, i + d));
    if (j !== i) onChange(stops[j]!);
  };
  const fromPointer = (clientY: number) => {
    const el = track.current;
    if (!el || !stops.length) return;
    const r = el.getBoundingClientRect();
    const f = (clientY - r.top) / Math.max(1, r.height);
    const j = Math.min(stops.length - 1, Math.max(0, Math.floor(f * stops.length)));
    if (stops[j] !== value) onChange(stops[j]!);
  };
  const nameOf = (l: number | null) => (l === null ? t('cut.roof') : labelOf(l));
  return (
    <div
      className="glass vp-cut"
      onWheel={(e) => {
        e.preventDefault();
        step(e.deltaY > 0 ? 1 : -1);
      }}
    >
      <div className="vp-cut-head">
        <span>{withRoof ? t('cut.planTitle') : t('cut.title')}</span>
        {onClose && (
          <button
            type="button"
            className="vp-cut-close"
            title={t('cut.off')}
            aria-label={t('cut.off')}
            onClick={onClose}
          >
            <X size={13} strokeWidth={2} />
          </button>
        )}
      </div>
      <div
        ref={track}
        className="vp-cut-track"
        role="slider"
        tabIndex={0}
        aria-label={t('cut.title')}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={stops.length - 1}
        aria-valuenow={stops.length - 1 - i}
        aria-valuetext={nameOf(value)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e.clientY);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'PageUp') step(-1);
          else if (e.key === 'ArrowDown' || e.key === 'PageDown') step(1);
          else if (e.key === 'Home') onChange(stops[0]!);
          else if (e.key === 'End') onChange(stops[stops.length - 1]!);
          else return;
          e.preventDefault();
        }}
      >
        {stops.map((l, j) => (
          <div
            key={l ?? 'roof'}
            className={`vp-cut-stop${l === value ? ' is-on' : ''}${j < i ? ' is-hidden' : ''}${l === null ? ' is-roof' : ''}`}
          >
            <span className="vp-cut-dot" />
            <span className="vp-cut-name">{nameOf(l)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
