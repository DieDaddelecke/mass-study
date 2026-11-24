import * as RDialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';

/** Parse a number typed in fr/de ("12,5") or en ("12.5") notation. */
export function parseLocaleNumber(s: string): number | null {
  const clean = s.replace(/[\s\u202f\u00a0]/g, '').replace(',', '.');
  if (clean === '' || clean === '-') return null;
  const v = Number(clean);
  return Number.isFinite(v) ? v : null;
}

export interface NumFieldProps {
  value: number | null | undefined;
  onCommit: (v: number) => void;
  digits?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  disabled?: boolean;
  /** Placeholder shown for empty / mixed values. */
  placeholder?: string;
  ariaLabel?: string;
  suffix?: string;
  /** Called when the field is emptied (back to the default); without it the old value returns. */
  onClear?: () => void;
}

/** Numeric input that commits on Enter / blur only (one undo step per edit). */
export function NumField(props: NumFieldProps) {
  const { value, digits = 2, integer } = props;
  const { i18n } = useTranslation();
  const fmt = (v: number | null | undefined) =>
    v == null ? '' : formatNumber(v, integer ? 0 : digits, i18n.language);
  const [text, setText] = useState(fmt(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(fmt(value));
  }, [value, editing, i18n.language]); // fmt depends only on these

  const commit = () => {
    setEditing(false);
    let v = parseLocaleNumber(text);
    if (v == null) {
      if (props.onClear && text.trim() === '') {
        if (value != null) props.onClear();
        return;
      }
      setText(fmt(value));
      return;
    }
    if (integer) v = Math.round(v);
    if (props.min !== undefined) v = Math.max(props.min, v);
    if (props.max !== undefined) v = Math.min(props.max, v);
    setText(fmt(v));
    if (value == null || Math.abs(v - value) > 1e-9) props.onCommit(v);
  };

  return (
    <span className="numfield">
      <input
        type="text"
        inputMode="decimal"
        aria-label={props.ariaLabel}
        value={text}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(fmt(value));
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {props.suffix && <span className="numfield-suffix">{props.suffix}</span>}
    </span>
  );
}

export type TrafficStatus = 'ok' | 'warning' | 'error' | 'none';

export function TrafficDot({ status, title }: { status: TrafficStatus; title?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`traffic traffic-${status}`}
      title={title ?? t(`common:status.${status}`)}
      aria-label={title ?? t(`common:status.${status}`)}
    />
  );
}

export function Dialog(props: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <RDialog.Root open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="dlg-overlay" />
        <RDialog.Content
          className={`dlg${props.wide ? ' dlg-wide' : ''}`}
          aria-describedby={undefined}
        >
          <div className="dlg-head">
            <RDialog.Title className="dlg-title">{props.title}</RDialog.Title>
            <RDialog.Close className="ibtn" aria-label={t('common:actions.close')}>
              <X size={16} strokeWidth={1.75} />
            </RDialog.Close>
          </div>
          <div className="dlg-body">{props.children}</div>
          {props.footer && <div className="dlg-foot">{props.footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Label / control row used in palettes and dialogs. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="prow">
      <span className="prow-label">{label}</span>
      <span className="prow-value">{children}</span>
    </label>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="pgroup" open>
      <summary>{title}</summary>
      <div className="pgroup-body">{children}</div>
    </details>
  );
}

/** Tooltip wrapper (Radix). Needs a <Tooltip.Provider> at the app root. */
export function Tip(props: {
  label: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{props.children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" side={props.side ?? 'bottom'} sideOffset={8}>
          {props.label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Tooltip reason for disabled buttons (defaults to "en préparation"). */
  reason?: string;
  shortcut?: string;
  active?: boolean;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
  size?: number;
}

/** Icon-only button with an accessible label and a tooltip that includes the shortcut. */
export function IconButton(p: IconButtonProps) {
  const { t } = useTranslation();
  const Icon = p.icon;
  const disabled = p.disabled || !p.onClick;
  const tip = (
    <span className="tip-row">
      <span>{p.label}</span>
      {disabled ? (
        <span className="tip-muted">{p.reason ?? t('common:inPreparation')}</span>
      ) : (
        p.shortcut && <kbd className="kbd">{p.shortcut}</kbd>
      )}
    </span>
  );
  return (
    <Tip label={tip} side={p.side}>
      {/* span keeps the tooltip working on disabled buttons */}
      <span className="ibtn-wrap">
        <button
          type="button"
          className={`ibtn${p.active ? ' is-active' : ''}${p.className ? ` ${p.className}` : ''}`}
          aria-label={p.label}
          aria-pressed={p.active}
          aria-keyshortcuts={p.shortcut}
          disabled={disabled}
          onClick={p.onClick}
        >
          <Icon size={p.size ?? 18} strokeWidth={1.75} />
        </button>
      </span>
    </Tip>
  );
}

/** Segmented control for small enums. */
export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string; icon?: LucideIcon }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  iconOnly?: boolean;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={props.ariaLabel}>
      {props.options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={props.value === o.value}
            aria-label={props.iconOnly ? o.label : undefined}
            title={props.iconOnly ? o.label : undefined}
            className={`seg-btn${props.value === o.value ? ' is-on' : ''}`}
            onClick={() => props.onChange(o.value)}
          >
            {Icon && <Icon size={14} strokeWidth={1.75} />}
            {!props.iconOnly && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
