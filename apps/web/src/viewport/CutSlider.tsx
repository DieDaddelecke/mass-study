import { X } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Vertical storey slider of the storey cut (right edge of the 3D view): one stop per storey, the
 * highest on top. Click or drag along the track, mouse wheel, arrow keys / Page Up / Page Down.
 */
export function CutSlider({
  levels,
  labelOf,
  value,
  onChange,
  onClose,
}: {
  /** Storey indices, highest first. */
  levels: readonly number[];
  labelOf: (level: number) => string;
  value: number;
  onChange: (level: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('viewport');
  const track = useRef<HTMLDivElement>(null);
  const i = Math.max(0, levels.indexOf(value));
  const step = (d: number) => {
    const j = Math.min(levels.length - 1, Math.max(0, i + d));
    if (j !== i) onChange(levels[j]!);
  };
  const fromPointer = (clientY: number) => {
    const el = track.current;
    if (!el || !levels.length) return;
    const r = el.getBoundingClientRect();
    const f = (clientY - r.top) / Math.max(1, r.height);
    const j = Math.min(levels.length - 1, Math.max(0, Math.floor(f * levels.length)));
    if (levels[j] !== value) onChange(levels[j]!);
  };
  return (
    <div
      className="glass vp-cut"
      onWheel={(e) => {
        e.preventDefault();
        step(e.deltaY > 0 ? 1 : -1);
      }}
    >
      <div className="vp-cut-head">
        <span>{t('cut.title')}</span>
        <button
          type="button"
          className="vp-cut-close"
          title={t('cut.off')}
          aria-label={t('cut.off')}
          onClick={onClose}
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>
      <div
        ref={track}
        className="vp-cut-track"
        role="slider"
        tabIndex={0}
        aria-label={t('cut.title')}
        aria-orientation="vertical"
        aria-valuemin={levels[levels.length - 1]}
        aria-valuemax={levels[0]}
        aria-valuenow={value}
        aria-valuetext={labelOf(value)}
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
          else if (e.key === 'Home') onChange(levels[0]!);
          else if (e.key === 'End') onChange(levels[levels.length - 1]!);
          else return;
          e.preventDefault();
        }}
      >
        {levels.map((l, j) => (
          <div
            key={l}
            className={`vp-cut-stop${l === value ? ' is-on' : ''}${j < i ? ' is-hidden' : ''}`}
          >
            <span className="vp-cut-dot" />
            <span className="vp-cut-name">{labelOf(l)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
