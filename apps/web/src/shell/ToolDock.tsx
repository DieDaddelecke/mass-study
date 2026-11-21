import * as Menu from '@radix-ui/react-dropdown-menu';
import { Boxes, Layers, LandPlot, MousePointer2, Trash, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../store/uiStore';
import { getCommands, MODIFY_TOOLS, TEMPLATE_LIST, TYPOLOGIES, type Command } from './commandList';
import { activateTool, deleteSelection, isToolImplemented, placeTool } from './commands';
import { useShellStore } from './shellStore';
import { IconButton, Tip } from './ui';

function DockMenuButton(p: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const Icon = p.icon;
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Tip label={p.label} side="right">
        <Menu.Trigger
          className={`ibtn${p.active || open ? ' is-active' : ''}`}
          aria-label={p.label}
        >
          <Icon size={18} strokeWidth={1.75} />
        </Menu.Trigger>
      </Tip>
      <Menu.Portal>
        <Menu.Content
          className={`menu glass${p.wide ? ' menu-cards' : ''}`}
          side="right"
          align="start"
          sideOffset={12}
        >
          {p.children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function CardItem(p: {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const Icon = p.icon;
  return (
    <Menu.Item
      className={`card-item${p.active ? ' is-active' : ''}`}
      disabled={p.disabled}
      onSelect={p.onSelect}
    >
      <span className="card-icon">
        <Icon size={20} strokeWidth={1.6} />
      </span>
      <span className="card-label">{p.label}</span>
    </Menu.Item>
  );
}

function VolumesMenu() {
  const { t } = useTranslation('shell');
  const tool = useUiStore((s) => s.tool);
  const placeOk = isToolImplemented('place');
  return (
    <DockMenuButton icon={Boxes} label={t('dock.volumes')} active={tool.kind === 'place'} wide>
      <Menu.Label className="menu-label">{t('ribbon.panel.typologies')}</Menu.Label>
      <div className="card-grid">
        {TYPOLOGIES.map((g) => (
          <CardItem
            key={g.kind}
            icon={g.icon}
            label={t(`common:typology.${g.kind}`)}
            disabled={!placeOk}
            active={tool.kind === 'place' && tool.typologyKind === g.kind && !tool.template}
            onSelect={() => activateTool(placeTool(g.kind))}
          />
        ))}
      </div>
      <Menu.Label className="menu-label">{t('ribbon.panel.templates')}</Menu.Label>
      <div className="card-grid">
        {TEMPLATE_LIST.map((g) => (
          <CardItem
            key={g.id}
            icon={g.icon}
            label={t(`common:template.${g.id}`)}
            disabled={!placeOk}
            active={tool.kind === 'place' && tool.template === g.id}
            onSelect={() => activateTool(placeTool('freeLine', g.id))}
          />
        ))}
      </div>
    </DockMenuButton>
  );
}

function SiteMenu() {
  const { t } = useTranslation('shell');
  const { t: tc } = useTranslation();
  // Snapshot on render; the menu re-renders when it opens.
  const cmds: Command[] = getCommands().filter((c) => c.group === 'site');
  return (
    <DockMenuButton icon={LandPlot} label={t('ribbon.panel.site')}>
      {cmds.map((c) => {
        const Icon = c.icon;
        return (
          <Menu.Item
            key={c.id}
            className="menu-item"
            disabled={!c.enabled}
            onSelect={c.run}
            title={c.enabled ? undefined : (c.reason ?? tc('common:inPreparation'))}
          >
            <Icon size={16} strokeWidth={1.75} />
            <span className="menu-text">{c.label}</span>
            {!c.enabled && <span className="menu-hint">{c.reason}</span>}
          </Menu.Item>
        );
      })}
    </DockMenuButton>
  );
}

/** Vertical tool dock on the left edge. */
export function ToolDock() {
  const { t } = useTranslation('shell');
  const tool = useUiStore((s) => s.tool);
  const selection = useUiStore((s) => s.selection);
  const leftOpen = useShellStore((s) => s.leftOpen);
  const leftTab = useShellStore((s) => s.leftTab);
  return (
    <nav className="glass dock" aria-label={t('dock.label')}>
      <IconButton
        icon={MousePointer2}
        label={t('cmd.select')}
        shortcut="Esc"
        side="right"
        active={tool.kind === 'select'}
        onClick={() => activateTool({ kind: 'select' })}
      />
      <VolumesMenu />
      <span className="dock-sep" />
      {MODIFY_TOOLS.map((m) => (
        <IconButton
          key={m.code}
          icon={m.icon}
          label={t(`ribbon.tool.${m.tool.kind}`)}
          shortcut={m.code}
          side="right"
          active={tool.kind === m.tool.kind}
          disabled={!isToolImplemented(m.tool.kind)}
          onClick={() => activateTool(m.tool)}
        />
      ))}
      <IconButton
        icon={Trash}
        label={t('common:actions.delete')}
        shortcut="DE"
        side="right"
        disabled={!selection.length}
        reason={t('ribbon.selectFirst')}
        onClick={deleteSelection}
      />
      <span className="dock-sep" />
      <SiteMenu />
      <IconButton
        icon={Layers}
        label={t('layers.title')}
        side="right"
        active={leftOpen && leftTab === 'layers'}
        onClick={() => {
          const s = useShellStore.getState();
          if (s.leftOpen && s.leftTab === 'layers') s.setLeftOpen(false);
          else {
            s.setLeftTab('layers');
            s.setLeftOpen(true);
          }
        }}
      />
    </nav>
  );
}
