import { useTranslation } from 'react-i18next';
import { useViewportStore } from './viewportStore';

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
const SCALES = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000];
/** Size of a CSS pixel in millimetres (96 dpi). */
const PX_MM = 25.4 / 96;

/** Longest round length (m) whose bar fits in `maxPx`; null when the scale is unknown. */
export function scaleBarLength(pxPerMetre: number, maxPx = 84): number | null {
  if (!(pxPerMetre > 0)) return null;
  let best: number | null = null;
  for (const l of NICE) if (l * pxPerMetre <= maxPx) best = l;
  return best ?? NICE[0]!;
}

/** Approximate drawing scale on screen (1:n), rounded to a usual architectural scale. */
export function screenScale(pxPerMetre: number): number | null {
  if (!(pxPerMetre > 0)) return null;
  const n = 1000 / (pxPerMetre * PX_MM);
  let best = SCALES[0]!;
  for (const s of SCALES) if (Math.abs(Math.log(s / n)) < Math.abs(Math.log(best / n))) best = s;
  return best;
}

/** North arrow, scale bar and screen scale of the plan view (where the nav cube sits in 3D). */
export function PlanOverlay() {
  const { t } = useTranslation('viewport');
  const px = useViewportStore((s) => s.pxPerMetre);
  const len = scaleBarLength(px);
  const scale = screenScale(px);
  return (
    <div className="glass vp-plan-ov" aria-label={t('plan.overlay')}>
      <svg className="vp-north" viewBox="-20 -24 40 48" width={40} height={48} aria-hidden>
        <path d="M0 -20 L9 12 L0 6 L-9 12 Z" className="vp-north-arrow" />
        <text x="0" y="23" textAnchor="middle">
          N
        </text>
      </svg>
      {len !== null && (
        <div className="vp-scale">
          <div className="vp-scale-bar" style={{ width: Math.round(len * px) }} />
          <span>{len} m</span>
        </div>
      )}
      {scale !== null && <span className="vp-scale-ratio">≈ 1:{scale}</span>}
    </div>
  );
}
