import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '../i18n';
import { palaiseauDemo } from '../demo/palaiseau';
import { useProjectStore } from '../store/projectStore';
import { KpiBar } from './KpiBar';

describe('KPI bar', () => {
  afterEach(cleanup);

  it('renders French KPIs with French number format for the demo project', () => {
    useProjectStore.getState().load(palaiseauDemo());
    const { container } = render(<KpiBar />);
    expect(screen.getByText('Emprise au sol')).toBeTruthy();
    expect(screen.getByText('CES')).toBeTruthy();
    expect(screen.getByText('Surface de plancher')).toBeTruthy();
    expect(screen.getByText('Logements')).toBeTruthy();
    const ces = container.querySelector('[data-kpi="ces"] .kpi-value')!.textContent!;
    expect(ces).toMatch(/^\d+,\d %$/);
    const emprise = container.querySelector('[data-kpi="emprise"] .kpi-value')!.textContent!;
    // 50 m × 13 m bar → 650 m²
    expect(emprise.replace(/\s/g, ' ')).toBe('650 m²');
    const niveaux = container.querySelector('[data-kpi="niveaux"] .kpi-value')!.textContent!;
    expect(niveaux).toBe('R+4');
  });

  it('shows DE KPIs for the DE profile', () => {
    const p = palaiseauDemo();
    p.settings.profile = 'DE';
    useProjectStore.getState().load(p);
    render(<KpiBar />);
    expect(screen.getByText('GRZ')).toBeTruthy();
    expect(screen.getByText('GFZ')).toBeTruthy();
  });
});
