import * as RDialog from '@radix-ui/react-dialog';
import { CornerDownLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filterCommands, getCommands } from './commandList';
import { useShellStore } from './shellStore';

/** Ctrl+K / ⌘K command palette over every command of the app. */
export function CommandPalette() {
  const open = useShellStore((s) => s.paletteOpen);
  const setOpen = useShellStore((s) => s.setPaletteOpen);
  return (
    <RDialog.Root open={open} onOpenChange={setOpen}>
      <RDialog.Portal>
        <RDialog.Overlay className="dlg-overlay cp-overlay" />
        {open && <PaletteBody onClose={() => setOpen(false)} />}
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('shell');
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const all = useMemo(getCommands, []);
  const items = useMemo(() => filterCommands(all, query), [all, query]);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  const run = (i: number) => {
    const c = items[i];
    if (!c || !c.enabled) return;
    onClose();
    c.run();
  };

  return (
    <RDialog.Content className="glass cp" aria-describedby={undefined}>
      <RDialog.Title className="sr-only">{t('palette.title')}</RDialog.Title>
      <div className="cp-search">
        <Search size={18} strokeWidth={1.75} />
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="cp-list"
          aria-activedescendant={items[index] ? `cp-${items[index].id}` : undefined}
          placeholder={t('palette.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(index);
            }
          }}
        />
        <kbd className="kbd">Esc</kbd>
      </div>
      <ul id="cp-list" role="listbox" className="cp-list" ref={listRef}>
        {items.length === 0 && <li className="cp-empty">{t('palette.empty')}</li>}
        {items.map((c, i) => {
          const Icon = c.icon;
          return (
            <li
              key={c.id}
              id={`cp-${c.id}`}
              data-index={i}
              role="option"
              aria-selected={i === index}
              aria-disabled={!c.enabled}
              className={`cp-item${i === index ? ' is-active' : ''}${c.enabled ? '' : ' is-disabled'}`}
              onMouseMove={() => i !== index && setIndex(i)}
              onClick={() => run(i)}
            >
              <span className="cp-icon">
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <span className="cp-label">{c.label}</span>
              <span className="cp-group">
                {c.enabled ? t(`palette.groups.${c.group}`) : c.reason}
              </span>
              {c.shortcut && <kbd className="kbd">{c.shortcut}</kbd>}
            </li>
          );
        })}
      </ul>
      <div className="cp-foot">
        <span>
          <kbd className="kbd">↑</kbd>
          <kbd className="kbd">↓</kbd> {t('palette.navigate')}
        </span>
        <span>
          <kbd className="kbd">
            <CornerDownLeft size={11} />
          </kbd>{' '}
          {t('palette.run')}
        </span>
      </div>
    </RDialog.Content>
  );
}
