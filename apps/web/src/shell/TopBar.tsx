import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  Check,
  ChevronDown,
  Download,
  FilePlus,
  FolderOpen,
  Info,
  Monitor,
  Moon,
  Redo2,
  Save,
  SaveAll,
  Search,
  Settings,
  Sun,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { actions, activeVariant, useProjectStore } from '../store/projectStore';
import { useArchicadStore } from '../archicad/archicadStore';
import { useThemeStore, type ThemePreference } from '../theme/themeStore';
import { closeProject, newProject, openFromFile, redo, save, saveAs, undo } from './commands';
import { useShellStore } from './shellStore';
import { IconButton, Tip } from './ui';

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform);
export const MOD_KEY = isMac ? '⌘' : 'Ctrl';

export function BrandMark() {
  const { t } = useTranslation();
  return (
    <span className="brand">
      <span className="brand-logo" aria-hidden />
      <span className="brand-name">{t('common:appName')}</span>
    </span>
  );
}

/** Inline-editable project name (Enter commits, Esc cancels). */
function ProjectName() {
  const { t } = useTranslation('shell');
  const name = useProjectStore((s) => s.project?.name ?? '');
  const [editing, setEditing] = useState<string | null>(null);
  if (editing !== null)
    return (
      <input
        className="tb-name-input"
        autoFocus
        aria-label={t('info.name')}
        value={editing}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={() => {
          if (editing.trim() && editing !== name) actions.rename(editing.trim());
          setEditing(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(null);
        }}
      />
    );
  return (
    <button
      type="button"
      className="tb-name"
      title={t('topbar.rename')}
      onClick={() => setEditing(name)}
    >
      {name}
    </button>
  );
}

function VariantSwitcher() {
  const { t } = useTranslation('shell');
  const project = useProjectStore((s) => s.project)!;
  const active = activeVariant(project);
  return (
    <Menu.Root>
      <Menu.Trigger className="pill pill-btn" aria-label={t('browser.variants')}>
        <span className="pill-dot" />
        {active.name}
        <ChevronDown size={14} strokeWidth={1.75} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu glass" sideOffset={8} align="start">
          <Menu.Label className="menu-label">{t('browser.variants')}</Menu.Label>
          {project.variants.map((v) => (
            <Menu.Item
              key={v.id}
              className="menu-item"
              onSelect={() => actions.setActiveVariant(v.id)}
            >
              <span className="menu-check">
                {v.id === project.activeVariantId && <Check size={14} />}
              </span>
              {v.name}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function TopLeft() {
  const { t } = useTranslation('shell');
  return (
    <div className="glass tb tb-left">
      <BrandMark />
      <span className="tb-sep" />
      <ProjectName />
      <VariantSwitcher />
      <span className="tb-sep" />
      <IconButton icon={Undo2} label={t('cmd.undo')} shortcut={`${MOD_KEY}+Z`} onClick={undo} />
      <IconButton icon={Redo2} label={t('cmd.redo')} shortcut={`${MOD_KEY}+Y`} onClick={redo} />
    </div>
  );
}

function MenuItem(p: {
  icon: LucideIcon;
  label: string;
  onSelect?: () => void;
  shortcut?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = p.icon;
  return (
    <Menu.Item
      className="menu-item"
      disabled={p.disabled || !p.onSelect}
      onSelect={p.onSelect}
      title={p.disabled || !p.onSelect ? t('common:inPreparation') : undefined}
    >
      <Icon size={16} strokeWidth={1.75} />
      <span className="menu-text">{p.label}</span>
      {p.shortcut && <kbd className="kbd">{p.shortcut}</kbd>}
    </Menu.Item>
  );
}

function FileMenu() {
  const { t } = useTranslation('shell');
  const setDialog = useShellStore((s) => s.setDialog);
  return (
    <Menu.Root>
      <Menu.Trigger className="btn btn-ghost btn-sm">
        {t('tabs.output')}
        <ChevronDown size={14} strokeWidth={1.75} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu glass" sideOffset={8} align="end">
          <MenuItem icon={FilePlus} label={t('file.new')} onSelect={newProject} />
          <MenuItem icon={FolderOpen} label={t('file.open')} onSelect={() => void openFromFile()} />
          <MenuItem icon={Save} label={t('file.save')} shortcut={`${MOD_KEY}+S`} onSelect={save} />
          <MenuItem icon={SaveAll} label={t('file.saveAs')} onSelect={saveAs} />
          <Menu.Separator className="menu-sep" />
          <Menu.Label className="menu-label">{t('file.export')}</Menu.Label>
          {(['ifc', 'xlsx', 'csv', 'pdf', 'dxf'] as const).map((f) => (
            <MenuItem key={f} icon={Download} label={t(`file.exportFormat.${f}`)} disabled />
          ))}
          <Menu.Separator className="menu-sep" />
          <MenuItem
            icon={Info}
            label={t('file.projectInfo')}
            onSelect={() => setDialog('projectInfo')}
          />
          <MenuItem icon={X} label={t('file.close')} onSelect={closeProject} />
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

const THEMES: { value: ThemePreference; icon: LucideIcon }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

/** Cycles light → dark → system. */
export function ThemeToggle() {
  const { t } = useTranslation('shell');
  const pref = useThemeStore((s) => s.preference);
  const setPref = useThemeStore((s) => s.setPreference);
  const i = THEMES.findIndex((x) => x.value === pref);
  const cur = THEMES[i] ?? THEMES[2]!;
  const next = THEMES[(i + 1) % THEMES.length]!;
  return (
    <IconButton
      icon={cur.icon}
      label={`${t('theme.label')} : ${t(`theme.${cur.value}`)}`}
      onClick={() => setPref(next.value)}
    />
  );
}

export function SearchButton() {
  const { t } = useTranslation('shell');
  const setOpen = useShellStore((s) => s.setPaletteOpen);
  return (
    <button type="button" className="search-btn" onClick={() => setOpen(true)}>
      <Search size={15} strokeWidth={1.75} />
      <span>{t('palette.open')}</span>
      <kbd className="kbd">{MOD_KEY} K</kbd>
    </button>
  );
}

export function TopRight() {
  const { t } = useTranslation('shell');
  const setDialog = useShellStore((s) => s.setDialog);
  const acReady = useArchicadStore((s) => s.status === 'ready' && s.port !== undefined);
  return (
    <div className="glass tb tb-right">
      <Tip label={acReady ? t('archicad:pill.ready') : t('status.archicad')}>
        <button
          type="button"
          className="pill pill-status"
          onClick={() => useArchicadStore.getState().openDialog()}
        >
          <span className={acReady ? 'dot' : 'dot dot-off'} />
          Archicad
        </button>
      </Tip>
      <FileMenu />
      <span className="tb-sep" />
      <ThemeToggle />
      <IconButton
        icon={Settings}
        label={t('file.settings')}
        onClick={() => setDialog('settings')}
      />
      <SearchButton />
    </div>
  );
}
