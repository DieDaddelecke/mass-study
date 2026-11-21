import { analyzeProject, createMass, createProject, rect } from '@kubatur/core';

const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** Temporary start page (P0): proves that the calculation core runs in the browser. */
function demo() {
  const p = createProject({
    name: 'Démo',
    lonLat: [2.198, 48.713],
    localBoundary: rect(-25, -20, 25, 20),
  });
  const m = createMass('zeile', { position: [-20, 0] });
  m.typology = { kind: 'zeile', length: 40, depth: 12, sections: 1, sectionOffset: 0 };
  m.storeys.parapet = 0;
  p.variants[0]!.masses.push(m);
  return analyzeProject(p);
}

export function App() {
  const a = demo();
  return (
    <main className="shell">
      <h1>Kubatur</h1>
      <p className="muted">Étude de capacité – l’interface est en cours de construction.</p>
      <table>
        <caption>Calcul de référence (terrain 50 × 40 m, barre 40 × 12 m, R+4)</caption>
        <tbody>
          <tr>
            <th>Emprise au sol</th>
            <td>{fmt.format(a.fr.emprise)} m²</td>
          </tr>
          <tr>
            <th>CES</th>
            <td>{fmt.format(a.fr.ces)}</td>
          </tr>
          <tr>
            <th>Surface de plancher (approx.)</th>
            <td>{fmt.format(a.fr.surfaceDePlancher)} m²</td>
          </tr>
          <tr>
            <th>Hauteur à l’acrotère</th>
            <td>{fmt.format(a.fr.hauteurAcrotere)} m</td>
          </tr>
          <tr>
            <th>Logements</th>
            <td>{a.fr.logements}</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}
