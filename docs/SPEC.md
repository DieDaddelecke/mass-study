# Projektauftrag: „Kubatur“ – Web-App für städtebauliche Massenstudien

> One-Shot-Auftrag für Claude Code. Du bist Senior Full-Stack-Engineer mit Erfahrung in Computational Design, Three.js, 2D-Plandarstellung und BIM-Austausch (IFC, Archicad). Baue die hier spezifizierte Web-App vollständig, lauffähig und getestet in diesem (leeren) Repository. Arbeite autonom, bis die Definition of Done (§19) erfüllt ist.

**Kurzfassung:** Architekt:innen wählen ein Grundstück, sehen es in 3D mit vereinfachter Umgebungsbebauung, ordnen Baukörper in typischen Bauformen an (Solitär, Zeile, Reihe, Freiform mit Bautiefe), stellen Geschosse und Höhen ein und erhalten live Flächen, Kennzahlen und mögliche Raum- und Wohnungstypologien. Aus dem Modell entsteht ein PDF-Plansatz (Lageplan, Ansichten, Schnitte, Axonometrie, Flächen). Das Volumenmodell lässt sich per Live-Link oder IFC an Archicad übertragen. Oberfläche und 3D-Darstellung orientieren sich an Revit.

---

## 0. Arbeitsweise

1. Lies dieses Dokument vollständig, bevor du Code schreibst. Lege danach `docs/ARCHITECTURE.md` an (Module, Datenfluss, zentrale Typen).
2. Erstelle einen Plan mit TodoWrite entlang der Phasen in §18. Arbeite die Phasen der Reihe nach ab. Eine Phase ist erst fertig, wenn `pnpm typecheck && pnpm lint && pnpm test && pnpm build` grün sind.
3. Stelle keine Rückfragen. Wenn etwas unklar ist, triff eine fachlich vernünftige Entscheidung und dokumentiere sie in `docs/DECISIONS.md` (Entscheidung, Begründung, verworfene Alternative).
4. Committe nach jeder Phase (`git init` falls nötig) mit Conventional-Commit-Messages.
5. Externe Schnittstellen (Geodienste, Archicad-/Tapir-Befehlsschemas, Library-APIs) recherchierst und verifizierst du vor der Implementierung (WebFetch/WebSearch). Nutze dafür Subagents, damit dein Hauptkontext schlank bleibt. Erfinde keine Endpunkte, Parameter oder Library-Funktionen. Ist ein Dienst nicht erreichbar: robuster Fallback und Eintrag in `docs/KNOWN_LIMITATIONS.md`.
6. Keine stillen Stubs. Jede Funktion in der UI funktioniert oder ist sichtbar deaktiviert („in Vorbereitung“) und in KNOWN_LIMITATIONS gelistet. Must-Features (§18) dürfen nicht deaktiviert sein.
7. Fachlogik (Geometrie, Flächen, Zeichnungen, IFC) ist reines TypeScript ohne DOM-Abhängigkeit, läuft in Node und im Web Worker und ist durch Unit-Tests abgedeckt.
8. Prüfe die Oberfläche visuell: Playwright-Screenshots der Hauptansichten nach `docs/screenshots/`, ansehen, Layoutfehler korrigieren.
9. Scope-Disziplin: erst alle Must-Features vollständig, dann Should, dann Could.
10. Am Ende: kurze Zusammenfassung (umgesetzt / nicht umgesetzt / empfohlene nächste Schritte).

---

## 1. Produkt

**Zielgruppe:** Architektur- und Stadtplanungsbüros in frühen Phasen (Machbarkeitsstudie, LPH 0–2, Wettbewerb).

**Kernablauf:**
1. Standort suchen → Grundstück (Flurstück/Parzelle) wählen, zeichnen oder importieren
2. Umgebung als vereinfachte Volumen (Grundriss × Höhe, LoD1) laden
3. Baukörper in typischen Bauformen anordnen, Geschosse und Höhen einstellen
4. Live: Flächen (DIN 277), Kennzahlen (GRZ/GFZ/…), mögliche Raumtypologien und Wohnungsmix
5. Dossier als PDF-Plansatz erzeugen
6. Volumenstudie nach Archicad übertragen

**Look & Feel:** angelehnt an Revit-Konzepte (Ribbon, Eigenschaftenpalette, Projektbrowser, Ansichtssteuerleiste, Navigationswürfel, visueller Stil „Verdeckte Kanten“, temporäre Bemaßung). Keine Autodesk-Logos, -Icons, -Namen oder -Assets kopieren; eigene, schlichte Icons im ähnlichen Duktus (Lucide als Basis oder eigene SVGs).

**Sprache:** UI Deutsch (Default), i18n-fähig mit i18next (FR, EN vorbereitet). Code und Identifier Englisch. Zahlenformat `de-DE` (1.234,56 m²).

---

## 2. Glossar (verbindliche Begriffe in der UI)

| Begriff | Bedeutung |
|---|---|
| Grundstück, Flurstück | Baugrundstück, ggf. aus mehreren Flurstücken zusammengelegt |
| Baufenster, Baugrenze, Baulinie | überbaubare Fläche bzw. Begrenzungslinien |
| Baukörper | platzierbares Volumen einer Bauform (≈ Revit-Volumenkörper) |
| Bauform | Solitär, Zeile, Reihe, Freiform (Linie mit Bautiefe), Freiform (Polygon) |
| Abschnitt | Teil einer Zeile/Reihe (Hauseingang bzw. Reihenhaus-Einheit) |
| Geschoss | UG, EG, OG, Staffelgeschoss (SG); Geschosshöhe = OKFF bis OKFF |
| Ebene | projektweite Höhenreferenz (wie Revit-Ebenen) |
| Kennzahlen | GR, GRZ, GF, GFZ, BMZ, BGF, BRI, KGF, NRF, NUF, VF, TF, WE, Stellplätze |
| Variante | alternative Bebauung desselben Grundstücks (≈ Entwurfsoption) |

---

## 3. Tech-Stack und Repository

pnpm-Monorepo, TypeScript `strict`, aktuelle Node-LTS.

```
/apps/web               Vite + React + TS (SPA)
/apps/server            Node (Hono): Geodaten-Proxy + Cache, liefert den Web-Build aus
/packages/core          Datenmodell, Bauform-Generatoren, Geschosslogik, Flächen/Kennzahlen, Regelwerk-Profile
/packages/drawing       2D-Zeichnungsmodell, Verdeckte-Kanten-Berechnung, Schnitte, SVG-/DXF-Renderer
/packages/ifc           IFC4-STEP-Writer
/tools/archicad-bridge  Python-Bridge (nur Standardbibliothek) + Mock-Archicad für Tests
/tools/validate_ifc.py  IFC-Validierung mit ifcopenshell (optional in Tests)
/docs                   ARCHITECTURE.md, DECISIONS.md, KNOWN_LIMITATIONS.md, screenshots/
```

Libraries (aktuelle stabile Versionen; begründete Abweichungen in DECISIONS.md):

- 3D: `three`, `@react-three/fiber`, `@react-three/drei`, `three-mesh-bvh`, `postprocessing` (AO, Outline)
- State: `zustand` + `immer`, Undo/Redo (`zundo` oder eigene Patch-History)
- Karte: `maplibre-gl` (Standortwahl, Flurstücksauswahl)
- Geometrie: ein gepflegter Clipper2-Port für JS (Offset + Boolean; Kandidaten prüfen), `earcut`, `polylabel`, `proj4`
- UI: Radix UI Primitives (Menüs, Dialoge, Tooltips, Tabs), TanStack Table, i18next
- Rechenlast: Web Worker mit Comlink für Kennzahlen und Zeichnungsgenerierung
- Export: `jspdf` + `svg2pdf.js` (Vektor-PDF), `exceljs` (XLSX), `dxf-parser` (Import)
- Tests: Vitest, Playwright

---

## 4. Datenmodell (`packages/core`)

**Koordinaten:** lokales metrisches System in m; x = Ost, y = Nord, z = oben; Ursprung = Schwerpunkt des Grundstücks. Projektion mit proj4: Frankreich EPSG:2154 (Lambert-93), Deutschland EPSG:25832/25833 (UTM 32N/33N je nach Längengrad), sonst passende UTM-Zone. CRS und Ursprung werden im Projekt gespeichert (für IFC-Georeferenzierung, DXF und Archicad).

```ts
type Vec2 = [number, number];
interface Polygon { outer: Vec2[]; holes?: Vec2[][] }          // außen CCW, Löcher CW

interface Project {
  schemaVersion: number;
  id: string; name: string;
  info: { address?: string; client?: string; author?: string; office?: string;
          date: string; revision: string; phase: string; logo?: string };
  geo: { crs: string; originCrs: Vec2; originLonLat: [number, number];
         groundElevation?: number /* ±0,00 in m ü. NHN bzw. NGF */ };
  site: Site;
  context: ContextBuilding[];
  variants: Variant[]; activeVariantId: string;
  views: ViewDef[];      // 3D, Axo, Lageplan, Grundrisse, Ansichten, Schnitte
  sheets: SheetDef[];    // Pläne des Dossiers
  settings: Settings;    // Regelwerk, Kennwerte, Wohnungsmix, Stellplätze, Stifte, Darstellung
  constraints: Constraints;
}

interface Site { parcels: Parcel[]; boundary: Polygon; buildable?: Polygon[]; buildingLines?: Vec2[][] }
interface Parcel { id: string; source: 'cadastre' | 'drawn' | 'import'; ref?: string; polygon: Polygon }
interface ContextBuilding {
  id: string; footprint: Polygon; height: number; baseHeight?: number; levels?: number;
  source: 'osm' | 'ign' | 'import' | 'manual'; heightEstimated: boolean; hidden?: boolean;
}

interface Variant { id: string; name: string; masses: Mass[] }

interface Mass {
  id: string; name: string;
  typology: Typology;                 // Discriminated Union, siehe §6
  position: Vec2; rotation: number;   // rad
  storeys: StoreyStack;
  segmentOverrides?: Record<number, Partial<StoreyStack>>;   // je Abschnitt (Zeile/Reihe)
  usageByStorey?: Record<number, Usage>;
  access?: AccessType | 'auto';       // Erschließungstyp
}

interface StoreyStack {
  basement: { count: number; height: number };
  ground:   { height: number };
  upper:    { count: number; height: number };
  heightOverrides?: { index: number; height: number }[];
  setback?: { storeys: number; distance: number | { front: number; back: number; left: number; right: number } };
  parapet: number;          // Attika/Dachaufbau
  slabThickness: number;    // Darstellung und IFC
}

type Usage = 'wohnen' | 'buero' | 'gewerbe' | 'gemeinbedarf' | 'parken' | 'technik';
type AccessType = 'zweispaenner' | 'dreispaenner' | 'laubengang' | 'mittelflur' | 'punkthaus' | 'reihenhaus' | 'buero';
```

**Zentrale abgeleitete Struktur.** 3D, Flächen, Zeichnungen, IFC und Archicad werden ausschließlich daraus erzeugt:

```ts
interface StoreySolid {
  massId: string; segment?: number;
  storeyIndex: number;          // -n … m, 0 = EG
  label: string;                // "UG", "EG", "1.OG", "SG"
  footprint: Polygon;           // Weltkoordinaten
  z0: number; z1: number;       // OKFF bis OKFF darüber
  usage: Usage; aboveGround: boolean;
}
function massToSolids(mass: Mass, settings: Settings): StoreySolid[];
```

Alle Funktionen in `core` sind pur, deterministisch und getestet. Projektdatei `*.massing.json` mit `schemaVersion` und Migrationsfunktionen.

---

## 5. Geodaten: Standort, Grundstück, Umgebung

Provider-Interfaces (austauschbar, konfigurierbar in `apps/server/config`):

```ts
interface GeocodeProvider { search(q: string): Promise<GeocodeResult[]> }
interface ParcelProvider  { id: string; covers(lonLat: [number, number]): boolean;
                            parcelsAt(lonLat: [number, number]): Promise<Parcel[]> }
interface ContextProvider { id: string; covers(lonLat: [number, number]): boolean;
                            buildings(bbox: BBox): Promise<ContextBuilding[]> }
```

Alle externen Abfragen laufen über `apps/server` (CORS, Rate-Limits, Cache auf Dateisystem oder SQLite, TTL 30 Tage, eigener User-Agent, Nutzungsbedingungen der Dienste beachten).

Umzusetzen (Endpunkte vorher verifizieren):

- **Geocoding:** Frankreich über die Géoplateforme-Geokodierung (IGN), sonst Nominatim oder Photon (max. 1 Anfrage/s, Cache).
- **Flurstücke Frankreich:** IGN API Carto, Modul Kataster (Parzelle am Klickpunkt).
- **Flurstücke Deutschland:** kein bundesweiter Dienst → generischer WFS-Provider (URL, TypeName, Feldzuordnung konfigurierbar) für die ALKIS- bzw. INSPIRE-Flurstücksdienste der Länder. Mindestens ein Land (z. B. NRW) als funktionierendes Beispiel, sofern verifizierbar.
- **Immer verfügbar:** Grundstück zeichnen (Karte oder Lageplan) und importieren (DXF mit geschlossener Polylinie, GeoJSON). Beim DXF-Import Einheit und Bezug abfragen (lokal oder Landeskoordinaten).
- **Umgebung:** OSM über Overpass (`building`, `building:part`; `height`, `min_height`, `building:levels`, `roof:levels`). Höhenregel: `height` → sonst Geschosse × 3,0 m → sonst 9 m mit `heightEstimated = true` (dezent anders dargestellt). Frankreich zusätzlich IGN BD TOPO (Gebäude mit Höhe) als bevorzugte Quelle. Import: GeoJSON mit Höhenattribut.
- Umgebungsradius einstellbar (Default 150 m, 50–500 m). Bestand auf dem Grundstück ein-/ausblendbar („Abbruch“).
- Nachbargebäude sind auswählbar; Höhe/Geschosse editierbar, ausblendbar, manuell zeichenbar.
- **Gelände:** eben auf ±0,00 (MVP).
- **Kartenunterlage:** MapLibre mit freiem Vektorstil (z. B. OpenFreeMap) für die Standortwahl. Should: Orthofoto (FR: IGN-WMTS, DE: konfigurierbar) als abschaltbare Bodentextur in 3D und Unterlage im Lageplan.

**Dialog „Neues Projekt“:** Adresse suchen → Karte → Flurstück(e) anklicken (Mehrfachauswahl = zusammenlegen) oder zeichnen/importieren → Umgebungsradius → „Projekt anlegen“ → 3D-Ansicht öffnet sich.

---

## 6. Modellierung: Bauformen und Werkzeuge

| Bauform | Parameter (Defaults) | Erzeugung |
|---|---|---|
| Solitär (Punkthaus) | Länge 20 m, Tiefe 20 m | Rechteck |
| Zeile | Länge 40 m, Bautiefe 12 m, Abschnitte 3, Versatz je Abschnitt 0 m | Rechteck, in Abschnitte geteilt; Abschnitte in Lage und Höhe staffelbar |
| Reihe | Anzahl 6, Hausbreite 6,0 m, Tiefe 10 m, alternierender Versatz 0 m, Endhausbreite optional | n aneinandergereihte Einheiten, jede ein Abschnitt |
| Freiform (Linie) | Polylinie offen/geschlossen, Bautiefe 12 m, Ausrichtung Mitte/links/rechts | Clipper-Offset mit Gehrung (Miter-Limit); geschlossene Linie → Innenhof als Loch |
| Freiform (Polygon) | freier Umriss, Löcher erlaubt | direkt |

Vorlagen in der Ribbon-Galerie: „Winkel“, „U-Form“, „Blockrand“, „Hofhaus“ als vorkonfigurierte Freiform-Linien.

**Werkzeuge (Revit-artig):**

- **Platzieren:** Bauform wählen → Optionsleiste zeigt die Parameter → Klick setzt den Einfügepunkt, zweiter Klick die Richtung. Freiform: Punkte klicken, Doppelklick/Enter beendet, Esc bricht ab. Zahleneingabe während des Zeichnens setzt die Länge des aktuellen Segments.
- **Fangen:** Endpunkte, Mittelpunkte, Kanten (Grundstück, Baufenster, Baukörper, Nachbarn), parallel/rechtwinklig zu Grundstückskanten, Winkelraster 15°, Raster 0,5 m; Fangsymbole wie in CAD üblich.
- **Auswahl:** Klick, Strg+Klick, Fenster links→rechts (vollständig enthalten), rechts→links (kreuzend), Tab zum Durchschalten.
- **Ändern:** Verschieben (MV), Drehen (RO), Kopieren (CO), Spiegeln (MM), Reihe (AR), Ausrichten (AL), Löschen (Entf/DE); Gizmos in 3D, Griffe in 2D.
- **Formgriffe** (blaue Pfeile) für Länge, Tiefe und Stützpunkte; in 3D zusätzlich ein Höhengriff oben, der in ganzen Geschossen einrastet.
- **Temporäre Bemaßung** (blau) bei Auswahl in 2D: Abstände zu den nächsten Grundstücksgrenzen und eigene Abmessungen; Klick auf den Maßtext → Wert eintippen → Baukörper verschiebt bzw. ändert sich.
- **Undo/Redo** (Strg+Z / Strg+Y), mindestens 100 Schritte.
- **Prüfungen** (Revit-artiger Warnungsdialog + Badge in der Statusleiste): Baukörper überlappen; außerhalb Grundstück/Baufenster; Kennzahl über Vorgabe; Bautiefe außerhalb des Richtwerts der Nutzung; Abstandsflächen-Konflikt (wenn aktiv); Umgebung mit geschätzten Höhen.

---

## 7. Geschosse und Höhen

- Je Baukörper (und je Abschnitt überschreibbar): UG-Anzahl/-Höhe, EG-Höhe (Default 3,50 m; Gewerbe 4,00 m), Regel-OG-Anzahl/-Höhe (Default Wohnen 3,00 m, Büro 3,50 m), Einzelhöhen, Staffelgeschoss(e) mit Rücksprung (allseitig oder je Seite), Attika (Default 0,50 m).
- Nutzung je Geschoss; Schnellwahl „EG Gewerbe, OG Wohnen“.
- Geschossnotation umschaltbar: „EG + 4 OG + SG“, römisch „V + S“, französisch „R+4+C“.
- **Projekt-Ebenen:** Vereinigung aller OKFF-Höhen aller Baukörper (Toleranz 5 cm), automatisch benannt; in Ansichten und Schnitten als Ebenenlinien mit Kotenkopf; dieselbe Liste dient als Archicad-Geschossstruktur.
- Gesamthöhe = OK Attika über ±0,00. „Höhe nach MBO“ = OKFF des obersten Geschosses mit möglichem Aufenthaltsraum über Gelände im Mittel (eben angenommen).

---

## 8. Berechnungen (`packages/core`, live)

Alle Werte sind überschlägig (Machbarkeit). Alle Kennwerte sind im Dialog „Kennwerte“ editierbar, mit Default und Kurzbegründung, als Büro-Vorlage speicherbar.

### 8.1 Flächen nach DIN 277 (je StoreySolid, aggregiert je Geschoss, Baukörper, Variante)

- **BGF** = Grundrissfläche außen (Regelfall R)
- **KGF** = Umfang × Außenwanddicke (Default 0,40 m) + BGF × Innenwand-/Konstruktionsanteil (Default 5 %)
- **NRF** = BGF − KGF
- **VF** = NRF × Verkehrsflächenanteil (abhängig vom Erschließungstyp, §8.4)
- **TF** = NRF × Technikanteil (Default 2 %)
- **NUF** = NRF − VF − TF
- **BRI** = Σ BGF × Geschosshöhe (oberstes Geschoss inkl. Attika)
- **Wohnfläche** (Näherung) = NUF Wohnen × Faktor (Default 1,0); Balkone optional mit Anrechnungsfaktor
- Getrennt ausweisen: oberirdisch / unterirdisch

### 8.2 Kennzahlen – Regelwerk-Profil DE

- Grundstücksfläche; **GR** = Vereinigung aller oberirdischen Footprints (Boolean, überlappungsfrei); **GRZ** = GR / Grundstücksfläche
- **GF** = Σ BGF der Vollgeschosse; **GFZ** = GF / Grundstücksfläche; zusätzlich „GFZ aller oberirdischen Geschosse“
- **BMZ** = Baumasse / Grundstücksfläche
- **Vollgeschoss-Regel** konfigurierbar (Landesrecht), Default: oberirdisches Geschoss (OK Decke im Mittel > 1,40 m über Gelände) mit lichter Höhe ≥ 2,30 m über mehr als 2/3 der Grundfläche des darunterliegenden Geschosses (relevant für Staffelgeschosse). UI-Hinweis „Landesrecht prüfen“.
- Anzahl Vollgeschosse (max.), Gesamthöhe (max.), Höhe nach MBO
- **Gebäudeklasse** nach MBO § 2 Abs. 3 (vereinfacht: Höhe ≤ 7 m / ≤ 13 m, Nutzungseinheiten ≤ 400 m² aus Wohnungsmix bzw. Annahme); Hochhaus-Hinweis bei Höhe > 22 m
- Hinweis Aufzugspflicht bei Höhe > 13 m (MBO § 39 Abs. 4)
- Grobprüfung Rettungsweg: höchstens 35 m bis zum notwendigen Treppenraum (MBO § 35 Abs. 2) → Mindestanzahl Treppenkerne je Baukörper aus Länge und Erschließungstyp
- Soll/Ist mit Ampel gegen Vorgaben (GRZ, GFZ, BMZ, max. Vollgeschosse, max. Höhe, Bauweise offen/geschlossen, Baufenster)
- **Profil FR (Should):** emprise au sol + CES, surface de plancher (Näherung: BGF − Außenwände − konfigurierbare Abzüge), hauteur (égout/acrotère), R+n-Notation, französische Labels

### 8.3 Baurechtliche Vorgaben

Dialog „Baurechtliche Vorgaben“ (manuelle Eingabe) und Import per JSON nach `constraints.schema.json`: GRZ, GFZ, BMZ, maxHeight, maxFullStoreys, setbackFactor, buildable (GeoJSON), buildingLines (GeoJSON); FR: empriseMax, hauteurMax, prospects. So können externe Tools (B-Plan-/PLU-Analysen) Vorgaben liefern. Baufenster zusätzlich „aus Grenzabstand erzeugen“ (Grundstück nach innen versetzen).

### 8.4 Raumtypologien (je Baukörper bzw. Abschnitt)

- **Bautiefe:** Rechteck → kürzere Seite; Freiform-Linie → Parameter; Polygon → 2 × Radius des größten Inkreises (polylabel) als Näherung.
- **Eignung nach Bautiefe** (Richtwerte, editierbar), Ausgabe als Liste mit Ampel:
  - Wohnen: Laubengang 8–12 m · Zweispänner/Durchwohnen 10–13 m · Dreispänner 12–15 m · Mittelflur/Maisonette 15–20 m · Punkthaus (4- bis 6-Spänner um Kern) bei Solitär ab ca. 18 × 18 m · über 18 m Tiefe Warnung Belichtung (außer Punkthaus/Atrium)
  - Büro: Zellenbüro 12–14 m · Kombibüro 14–16 m · Großraum/Open Space 16–22 m
  - Gewerbe/Retail frei; Parken nur im UG (Tiefgarage)
- **Erschließungstyp** `auto` = bester Treffer, manuell überschreibbar; bestimmt den VF-Anteil (Defaults: Zweispänner 8 %, Dreispänner 9 %, Laubengang 10 %, Punkthaus 10 %, Mittelflur 15 %, Büro 15 %) und die Kernanzahl.

### 8.5 Wohnungsmix und weitere Nutzungen

- Mix-Vorlage editierbar: Typ (1-Zi … 5-Zi, Reihenhaus), Zielanteil %, Fläche min/Ziel/max.
- Anzahl WE = Wohnfläche / Σ(Anteil × Zielfläche); Verteilung auf Typen nach Largest-Remainder auf ganze Zahlen; Restfläche ausweisen. Reihe: 1 WE je Einheit.
- Plausibilisierung je Geschoss und Kern gegen den Spänner-Typ (Zweispänner 2, Dreispänner 3, Punkthaus 4–6 WE); Abweichungen als Hinweis.
- Büro: Arbeitsplätze = NUF Büro / Fläche je AP (Default 12 m²).
- **Stellplätze:** Schlüssel konfigurierbar (Platzhalter-Defaults, als satzungsabhängig gekennzeichnet: Wohnen 1,0 je WE, Büro 1 je 40 m² NUF, Gewerbe 1 je 35 m² NUF); TG-Kapazität = BGF Parken × 0,9 / 25 m² je Stellplatz.

### 8.6 Tabellen (TanStack Table, Optik wie eine Revit-Bauteilliste)

Gruppierung, Zwischensummen, Gesamtsumme, fixierte Kopfzeile, dichte Zeilen:

1. **Flächenaufstellung:** Variante › Baukörper › Geschoss | Nutzung | Geschosshöhe | OKFF | Vollgeschoss | BGF | KGF | NRF | NUF | VF | TF | BRI
2. **Kennzahlen:** Ist | Soll | Status
3. **Raumtypologien und Wohnungsmix:** je Baukörper Bautiefe, geeignete Typologien, gewählte Erschließung, Kerne, WE je Typ, Wohnfläche, Arbeitsplätze, Stellplatzbedarf/-angebot
4. **Variantenvergleich** (Should): Kennzahlen aller Varianten nebeneinander

Exporte: XLSX (mehrere Blätter, Zahlenformate, Summenformeln), CSV (`;`-getrennt, de-DE), Zwischenablage (TSV).
Performance: Neuberechnung < 50 ms bei 50 Baukörpern (Memoisierung je Baukörper-Hash, Berechnung im Worker).

---

## 9. UI/UX – Revit-orientiert

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Schnellzugriff: Speichern Undo Redo 3D Schnitt TL]   Projekt – Variante A     │
│ Datei │ Grundstück │ Volumen │ Ändern │ Ansicht │ Analyse │ Ausgabe │ Archicad │
│ ┌ Ribbon-Panels: große/kleine Buttons, Panel-Titel unten ───────────────────┐ │
├──────────────────────────────────────────────────────────────────────────────┤
│ Optionsleiste: Länge [40,00] Bautiefe [12,00] Ausrichtung [Mitte] Geschosse… │
├────────────────┬─────────────────────────────────────────────────────────────┤
│ Eigenschaften  │ [{3D}] [Lageplan] [Ansicht Süd] [Schnitt A] [Flächen]       │
│ (Typauswahl +  │ ┌─────────────────────────────────────────────┐  ┌───┐      │
│  Parameter-    │ │                                             │  │ ▣ │ Würfel│
│  gruppen)      │ │               Zeichenbereich                │  └───┘      │
├────────────────┤ │                                             │             │
│ Projektbrowser │ └─────────────────────────────────────────────┘             │
│ (Baum)         │ 1:500 │ Detail │ Stil │ Sonne │ Schatten │ Isolieren        │
├────────────────┴─────────────────────────────────────────────────────────────┤
│ Kennzahlen: GRZ 0,24 ● GFZ 1,20 ● Höhe 15,50 m ● WE 32 ● BGF 2.400 m²         │
│ Status: „Klicken Sie, um den Startpunkt festzulegen“ │ x/y │ Fang │ ⚠ 2        │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Ribbon-Registerkarten:**
  - *Datei* (Backstage): Neu, Öffnen, Speichern, Export (IFC, XLSX, CSV, PDF, DXF), Projektinformationen, Einstellungen
  - *Grundstück:* Standort, Flurstück (Kataster/Zeichnen/Import/Bearbeiten/Zusammenlegen), Umgebung (Laden, Radius, Höhen bearbeiten, Gebäude zeichnen), Baurecht (Vorgaben, Baufenster, Baugrenze/Baulinie)
  - *Volumen:* Bauformen-Galerie, Geschosse, Nutzung, Varianten
  - *Ändern:* MV, RO, CO, MM, AR, AL, Löschen
  - *Ansicht:* 3D, Lageplan, Grundriss, Ansichtsmarker, Schnittlinie, Axonometrie, Visueller Stil, Sonne/Schatten, Fenster nebeneinander, Sichtbarkeit
  - *Analyse:* Flächenaufstellung, Kennzahlen, Raumtypologien/Wohnungsmix, Abstandsflächen, Verschattung, Warnungen
  - *Ausgabe:* Dossier erstellen, Pläne verwalten, PDF, Tabellen-Export, IFC
  - *Archicad:* Verbinden, Übertragen, Aktualisieren, Skript exportieren, IFC für Archicad, Hilfe
  - farblich hervorgehobene Kontext-Registerkarte „Ändern | Baukörper“ bei Auswahl
- **Optionsleiste** unter dem Ribbon: Parameter des aktiven Werkzeugs.
- **Eigenschaftenpalette** (links oben, andockbar): Typauswahl-Dropdown mit Vorschaubild; darunter einklappbare Gruppen (Abhängigkeiten, Abmessungen, Geschosse, Nutzung, Identitätsdaten, Kennwerte schreibgeschützt). Button „Typ bearbeiten“: Typen = gespeicherte Parametervorlagen je Bauform, duplizierbar. Ohne Auswahl zeigt sie die Eigenschaften der aktiven Ansicht (Maßstab, Stil, Zuschnitt).
- **Projektbrowser** (links unten):
  ```
  Ansichten
  ├─ 3D-Ansichten: {3D}, Axonometrie SW, Axonometrie NO
  ├─ Lageplan
  ├─ Grundrisse: UG, EG, 1.OG … (je Projekt-Ebene)
  ├─ Ansichten: Nord, Ost, Süd, West
  └─ Schnitte: Schnitt A, Schnitt B
  Listen: Flächenaufstellung, Kennzahlen, Raumtypologien & Wohnungsmix, Variantenvergleich
  Pläne: MS-001 Deckblatt, MS-002 Lageplan, …
  Varianten: ● Variante A, Variante B
  Grundstück & Umgebung: Flurstücke, Baufenster, Nachbargebäude
  ```
  Doppelklick öffnet eine Ansicht als Tab; Fenster nebeneinander (WT).
- **Ansichtssteuerleiste** unter jeder Ansicht: Maßstab, Detailgrad, Visueller Stil, Sonne/Schatten, Zuschneiden, temporär ausblenden/isolieren, Analysedarstellung.
- **Navigationswürfel** rechts oben in 3D: Flächen, Kanten und Ecken klickbar → animierte Kameraausrichtung; Kompassring N/O/S/W; Home-Button.
- **Statusleiste:** Werkzeughinweise, Koordinaten, Fangmodus, Warnungs-Badge, Verbindungsstatus Archicad.
- **Kennzahlenleiste** unten (andockbar) mit Live-Ampeln.
- **Navigation:** Mausrad zoomt um den Cursor, mittlere Taste schwenkt, Umschalt + mittlere Taste orbitet (3D). Trackpad-Modus umschaltbar: Zwei-Finger-Pan, Pinch-Zoom, Umschalt + Linksziehen Orbit.
- **Tastenkürzel** (zweibuchstabig, in Einstellungen editierbar): MV, RO, CO, MM, AR, AL, DE, ZF (Zoom Grenzen), ZA, HH/HI/HR (ausblenden/isolieren/zurücksetzen), WT, VV (Sichtbarkeit), TL (dünne Linien); dazu Strg+S/Z/Y, Esc.

**Design-Tokens** (CSS-Variablen, Light Theme):

```
--bg #F3F3F3  --panel #FFFFFF  --panel-header #E9E9E9  --border #CDCDCD
--text #1F1F1F  --text-muted #6B6B6B  --hover #E3EEF9  --accent #1F7FD0
--selection #2F8BE6  --temp-dim #1559D6  --warning #E8A600  --error #D23B2F  --ok #2E9E4F
```

Schrift: „Segoe UI“, Selawik (OFL, mitliefern), system-ui; Basis 12 px, Tabellen 11 px; dichte Abstände (4/8 px), Linien statt Schatten, Eckenradius max. 2 px. Keine Material- oder Bootstrap-Optik, kein übermäßiger Weißraum: das ist ein Profiwerkzeug.

---

## 10. 3D-Ansicht

- **Visuelle Stile:** Drahtmodell · Verdeckte Kanten (Default) · Schattiert · Konsistente Farben · Realistisch (Sonne, Schatten, AO).
  - Verdeckte Kanten: weiße Flächen (polygonOffset), schwarze Kanten (EdgesGeometry, Feature-Winkel 30°), Silhouetten dicker (LineSegments2/LineMaterial, 2 px), Umgebung hellgrau mit grauen Kanten.
  - Baukörper warm-hellgrau mit feinen Geschossdeckenlinien auf den Fassaden (wie Revit-Volumengeschosse). Nutzungsfarben im Stil „Konsistente Farben“ mit Legende (Wohnen gelb, Büro blau, Gewerbe rot, Gemeinbedarf violett, Parken grau).
  - Auswahl: halbtransparente blaue Hervorhebung + Griffe; Hover: blaue Kontur.
  - Grundstück: kräftige Strich-Punkt-Linie + leicht getönte Fläche; Baufenster gestrichelt.
  - Nachbarn mit geschätzter Höhe: gestrichelte Kanten oder leicht abweichender Ton.
- Hintergrund Weiß oder Verlauf (Himmel → Weiß); Boden Kartentextur (abschaltbar) oder Neutralgrau.
- Kamera perspektivisch/orthografisch umschaltbar; gespeicherte 3D-Ansichten (Kamera je ViewDef).
- **Sonne/Schatten** (Should): Sonnenstand aus Standort, Datum/Uhrzeit-Slider, Presets 21.3./21.6./21.12.
- **Performance:** Umgebung und Kanten gemergt (BufferGeometryUtils); ≥ 50 fps bei 2.000 Nachbargebäuden und 50 Baukörpern auf einem Mittelklasse-Laptop; Picking über three-mesh-bvh.

---

## 11. 2D-Ansichten und Zeichnungs-Engine (`packages/drawing`)

Ein Generator erzeugt aus `StoreySolid[]` + Umgebung + `ViewDef` ein neutrales **DrawingModel** (Linien mit Stiftnummer und Linientyp, gefüllte Polygone, Schraffuren, Texte, Bemaßungen, Symbole). Renderer: SVG (UI und PDF), DXF (Should). Dieselben Ansichten werden live in der UI und im Dossier verwendet, ohne doppelte Logik.

**Stifte** (mm bei 1:500, mit Maßstab skaliert, Tabelle editierbar): 1 = 0,13 (Hintergrund, Ebenenlinien) · 2 = 0,18 (Ansichtskanten fern) · 3 = 0,25 (Ansichtskanten) · 4 = 0,35 (Konturen/Silhouette) · 5 = 0,50 (Schnittkanten) · 6 = 0,70 (Grundstücksgrenze, Geländelinie). „Dünne Linien“-Modus (TL) in der UI.

**Ansichtstypen:**

1. **Lageplan** (1:500/1:1000): Grundstück (Strich-Punkt, Stift 6, Flurstücksnummer), Baufenster/Baugrenze/Baulinie, Nachbarbebauung hellgrau gefüllt mit Geschosszahl in römischen Ziffern, Baukörper (Farbschema umschaltbar: „Wettbewerb“ schwarz/dunkelgrau oder „Bauantrag“ rot angelegt), Geschossangabe + Kote OK Attika, Bemaßung der Baukörper und Abstände zu den Grenzen, Abstandsflächen (Should), Nordpfeil, Maßstabsleiste, Legende, optionale Kartenunterlage.
2. **Grundrisse je Ebene** (Should, schematisch 1:500): Schnitt aller Baukörper auf der Ebene, Nutzungsfarbe, BGF als Text, Kerne als Platzhalter-Rechtecke.
3. **Ansichten:** Standard N/O/S/W; Option „am Grundstück ausrichten“ (senkrecht zur längsten Grundstückskante); weitere per Ansichtsmarker. Inhalt: Geländelinie, Baukörper mit verdeckten Kanten entfernt, Geschosslinien optional, Nachbarn grau (optional), Ebenen mit Kotenköpfen (±0,00; +3,50 …), Kote OK Attika.
4. **Schnitte:** Schnittlinie im Lageplan/Grundriss setzen (Schnittkopf mit Nummer und Blickrichtungsdreieck, begrenzte Tiefe); Default Längs- und Querschnitt durch den Grundstücksschwerpunkt. Inhalt: geschnittene Baukörper als Poché (schwarz/dunkelgrau, Stift 5), Geschossdecken, Ansicht dahinter mit verdeckten Kanten, geschnittene Nachbarn grau, Geländelinie, Ebenen, Koten, Grundstücksgrenzen als vertikale Markierungen.
5. **Axonometrie:** Isometrie und Grundriss-Axonometrie (45°/45° und 30°/60°), Blickrichtung SW/SO/NO/NW. Als Vektor (verdeckte Kanten, Dachflächen hellgrau, Nachbarn grau) und als Rastervariante „schattiert“ aus dem 3D-Renderer (hohe Auflösung, AO, Schatten) fürs Deckblatt.

**Algorithmus „Verdeckte Kanten“ (exakte Vektorausgabe):**

- Kantenkandidaten aus den Prismen: vertikale Kanten, obere/untere Umrisskanten, optional Geschosslinien.
- Orthografische Projektion, Rückseiten-Culling.
- Sichtbarkeit je Kante: adaptiv abtasten, Strahl vom Abtastpunkt Richtung Betrachter gegen eine BVH aller Flächen (three-mesh-bvh, läuft in Node ohne WebGL), Wechsel sichtbar/verdeckt per Bisektion auf 1 mm genau → sichtbare Teilsegmente. Prüfe zusätzlich die Library `three-edge-projection` als mögliche Basis und entscheide begründet.
- Flächenfüllungen per Painter-Sortierung; die Kanten liegen immer exakt darüber.
- Schnitt: Footprint jedes Prismas analytisch mit der vertikalen Schnittebene schneiden → Intervalle × [z0, z1] = Poché. Geometrie hinter der Ebene per Halbraum-Clipping der Footprints (2D-Boolean), dann wie Ansicht.
- Überlappende Baukörper erzeugen eine Warnung; die Zeichnung bleibt korrekt.
- Unit-Tests mit bekannten Fällen: zwei hintereinanderstehende Quader, L-Form, Hof, Staffelgeschoss, Schnitt durch einen Hof.

---

## 12. Dossier / Plansatz (PDF)

- Pläne (Sheets) erscheinen im Projektbrowser. Dialog „Dossier erstellen“: Variante, Format (A3 quer Default, A2, A1), Planinhalte ankreuzen, Maßstab je Plan (Auto = größter passender Normmaßstab aus 1:200/1:250/1:500/1:1000/1:2000), Farbschema, Plankopf-Felder, Logo-Upload → seitenweise Vorschau → Export.
- **Standard-Plansatz:**
  1. Deckblatt: Projektname, Adresse, Variante, Axonometrie, Kennzahlenkasten
  2. Lageplan
  3. Ansichten (alle vier auf einem Blatt oder je zwei)
  4. Schnitte (mindestens zwei)
  5. Axonometrie(n) aus mehreren Blickrichtungen
  6. Flächenaufstellung, Kennzahlen, Raumtypologien/Wohnungsmix (Tabellen als Vektor, ggf. mehrseitig)
  7. Optional: Geschossschemata, Variantenvergleich, Abstandsflächenplan, Schattenstudie
- **Plankopf** (rechts unten, ca. 180 × 60 mm): Büro/Logo, Projekt, Adresse, Bauherr, Planinhalt, Plannummer (MS-002), Maßstab, Format, Datum, Index, Phase „Massenstudie“, Vermerk „Überschlägige Flächenermittlung nach DIN 277 – ohne Gewähr“.
- Jede Ansicht im Plan: Titel mit Nummernkreis, Maßstab, Nordpfeil wo sinnvoll, Maßstabsleiste.
- **Technik:** SVG → jsPDF via svg2pdf.js; echte Vektoren, selektierbarer Text, eingebettete OFL-Schrift (Umlaute, ², ±), Linienstärken exakt in mm; Rasterbilder (schattierte Axo) ≥ 200 dpi. Zusätzlich Einzelexport je Plan als SVG/PNG.
- **Abnahme:** Standard-Plansatz in A3 < 10 MB, öffnet fehlerfrei in Acrobat, Vorschau und Firefox; Maßstab nachmessbar (1:500 → 10 m = 20 mm).

---

## 13. Austauschformate

- **Projekt:** `.massing.json` Import/Export, Autosave in IndexedDB, Projektliste beim Start.
- **Tabellen:** XLSX, CSV (§8.6).
- **Zeichnungen:** PDF, SVG, PNG; DXF (Should: Layer je Stift/Kategorie, Lageplan lokal oder in Landeskoordinaten).
- **IFC4** (Must, `packages/ifc`, eigener STEP-Writer):
  - IfcProject (Einheiten m, m², m³, rad) › IfcSite (RefLatitude/RefLongitude, Grundstück als Footprint, IfcMapConversion + IfcProjectedCRS aus dem Projekt-CRS) › IfcBuilding „Massenstudie – {Variante}“ › IfcBuildingStorey je Projekt-Ebene (Name, Elevation).
  - Je StoreySolid ein IfcSpace: Name „BK1-02“, LongName = Nutzung, Body = IfcExtrudedAreaSolid mit IfcArbitraryClosedProfileDef (bzw. …ProfileDefWithVoids bei Höfen), Qto_SpaceBaseQuantities (Height, GrossFloorArea, NetFloorArea, GrossVolume), Pset_SpaceCommon, eigenes Pset_Massenstudie (Baukörper, Bauform, Nutzung, Vollgeschoss, Variante).
  - Exportoptionen: Volumenkörper als IfcBuildingElementProxy je Baukörper-Geschoss; Geschossdecken als IfcSlab; Umgebung als IfcBuildingElementProxy im IfcSite.
  - Gültige IFC-GUIDs (22 Zeichen, IFC-Base64), OwnerHistory, Repräsentationskontexte Model/Body/FootPrint.
  - Test: Ist Python verfügbar, `pip install ifcopenshell` und `tools/validate_ifc.py` prüft Ladbarkeit, Anzahl Storeys/Spaces und Flächen gegen die Erwartung; sonst wird der Test mit Hinweis übersprungen.

---

## 14. Archicad-Anbindung

Drei Wege in der Registerkarte „Archicad“:

**A) IFC für Archicad (Must):** wie §13, mit Archicad-freundlichen Defaults (IfcSpace → Zonen, Storeys → Geschosse). Hilfedialog: Einfügen in ein bestehendes Projekt per IFC-Zusammenführung oder als Hotlink; Hinweis zu Projektnullpunkt/Vermessungspunkt.

**B) Live-Link über lokale Bridge (Must):**

- Archicad stellt lokal eine JSON-API bereit (`http://127.0.0.1:19723`, bei mehreren Instanzen Ports 19723–19744). Elemente werden über das Add-On **Tapir** (GitHub: ENZYME-APD/tapir-archicad-automation) erzeugt, aufgerufen via `API.ExecuteAddOnCommand` mit `commandNamespace: "TapirCommand"`.
- **Vor der Implementierung** die aktuellen Befehlsschemas recherchieren (Tapir-Dokumentation und `command_definitions` im Repo) – insbesondere GetStories/SetStories, CreateZones, CreateSlabs, Elemente löschen und ggf. Morph-/Mesh-/Polylinien-Erzeugung – und typisierte Payload-Builder anlegen. Nichts raten.
- `tools/archicad-bridge/bridge.py` (Python ≥ 3.10, nur Standardbibliothek):
  - bindet ausschließlich auf `127.0.0.1:19780`; CORS nur für die konfigurierte App-Origin; Browser-Regeln für Zugriffe auf localhost (Private/Local Network Access) berücksichtigen: Preflight-Header und ggf. Berechtigungsabfrage des Browsers, im README dokumentiert
  - Pairing-Token: wird beim Start in der Konsole angezeigt und einmalig in der Web-App eingegeben
  - Endpunkte: `GET /health`, `GET /instances` (Ports scannen, Produktinfo, Projektname), `POST /push` (Ebenen, Zonen, Decken, Optionen; Modus `create` | `replace`), `POST /dry-run` (liefert die Archicad-Befehle, ohne sie auszuführen)
- **Übertragungslogik:**
  - Geschosse: Standard = vorhandene Archicad-Geschosse per nächster Höhe zuordnen, nur fehlende anlegen. „Geschossstruktur überschreiben“ nur nach expliziter Bestätigung (Warnung: verändert die Projektstruktur).
  - Je StoreySolid eine Zone (Polygon, Höhe, Name = Nutzung, Nummer „MS-BK1-02“), optional eine Decke.
  - Lage: lokale Projektkoordinaten oder mit Versatz/Drehung zum Archicad-Projektnullpunkt (Eingabe im Dialog).
  - Zurückgegebene GUIDs im Projekt speichern; „Aktualisieren“ ersetzt genau die zuvor erzeugten Elemente.
  - Fortschritt und Fehlerprotokoll in der UI.
- **Web-App:** Dialog „Mit Archicad verbinden“ (Bridge-Status, Instanzauswahl, Optionen, Mengenvorschau „n Geschosse, n Zonen“), Status in der Statusleiste.
- `tools/archicad-bridge/mock_archicad.py`: simuliert die JSON-API inklusive der verwendeten Tapir-Befehle (Schemaprüfung, Befehlsprotokoll) für automatisierte Tests und E2E.
- README-Abschnitt: Tapir installieren, Bridge starten (Windows/macOS), Troubleshooting.

**C) Skript-Export (Should):** Die Web-App erzeugt ein eigenständiges Python-Skript mit eingebetteter Payload, das dieselben Befehle gegen die laufende Archicad-Instanz ausführt – für Rechner ohne dauerhafte Bridge.

---

## 15. Varianten, Persistenz, Einstellungen

- Varianten anlegen, duplizieren, umbenennen, löschen, aktiv schalten (Projektbrowser + Ribbon); Vergleichstabelle; Dossier je Variante.
- Einstellungen: Regelwerk-Profil (DE/FR), Kennwerte, Wohnungsmix, Stellplatzschlüssel, Stifttabelle, Tastenkürzel, Maussteuerung, Sprache, Darstellungsschema; als JSON-Vorlage export-/importierbar (Büro-Standard).
- Kein Login, keine Mehrbenutzerfähigkeit im MVP.

---

## 16. Deployment

- Multi-Stage-`Dockerfile` + `docker-compose.yml`: ein Container; `apps/server` liefert den Web-Build und `/api/*` aus; Port 8080; Volume `/data` für den Cache; Konfiguration per ENV (Provider-URLs, User-Agent, Cache-TTL, erlaubte Origins). Lauffähig auf einem Home-Server hinter Reverse Proxy.
- `pnpm dev` startet Web + Server mit Hot Reload.

---

## 17. Tests und Qualität

- **Unit (Vitest)**, Abdeckung `core`, `drawing`, `ifc` ≥ 80 %:
  - Bauform-Generatoren (Maße, Rotation, Offset mit Gehrung, geschlossene Linie → Hof)
  - `massToSolids` (Staffelgeschoss-Rücksprung, Höhen-Overrides, UG, Abschnitts-Overrides)
  - **Referenzfall:** Grundstück 50 × 40 m (2.000 m²), Zeile 40 × 12 m, EG 3,50 m + 4 OG à 3,00 m, Attika 0, kein UG → GR 480 m², GRZ 0,24, BGF 2.400 m², GF 2.400 m², GFZ 1,20, BRI 7.440 m³, Gesamthöhe 15,50 m, Höhe nach MBO 12,50 m → Gebäudeklasse 4 (Nutzungseinheiten ≤ 400 m²), kein Aufzugshinweis
  - Vollgeschoss-Regel: Staffelgeschoss mit 60 % der Fläche darunter → kein Vollgeschoss; mit 70 % → Vollgeschoss
  - Wohnungsmix (Largest-Remainder, Summen konsistent)
  - Verdeckte Kanten und Schnitte (§11), IFC-Writer (Syntax, GUIDs, Referenzintegrität)
- **Bridge:** Python-Tests gegen `mock_archicad.py` (push, replace, dry-run, Fehlerfälle).
- **E2E (Playwright),** Geodienste gemockt: neues Projekt mit gezeichnetem Grundstück → Zeile platzieren → Geschosse ändern → Tabellenwerte prüfen → Schnitt anlegen → Dossier-PDF exportieren (Seitenzahl prüfen) → IFC exportieren → Archicad-Push gegen Mock.
- ESLint + Prettier, `pnpm typecheck` fehlerfrei, kein `any` in `core`.
- Screenshots nach `docs/screenshots/`: 3D (Verdeckte Kanten), Lageplan, Ansicht, Schnitt, Flächentabelle, Dossier-Vorschau.

---

## 18. Priorisierung und Phasen

**Must** (alles, was der Auftraggeber explizit verlangt):
- M1 Projekt anlegen: Geocoding, Flurstück (Kataster FR, generischer WFS DE, Zeichnen, DXF/GeoJSON-Import), Umgebung (OSM, IGN für FR), Nachbarhöhen editierbar
- M2 Bauformen Solitär, Zeile, Reihe, Freiform (Linie mit Bautiefe), Freiform (Polygon); Platzieren, Fangen, Griffe, MV/RO/CO/DE, Undo/Redo
- M3 Geschosse und Höhen inkl. UG, Staffelgeschoss, Nutzung je Geschoss
- M4 Flächen, Kennzahlen, Raumtypologien, Wohnungsmix; Tabellen; XLSX/CSV
- M5 Revit-orientierte Oberfläche (Ribbon, Eigenschaften, Projektbrowser, Ansichts-Tabs, Ansichtssteuerleiste, Navigationswürfel, Stil „Verdeckte Kanten“)
- M6 Live-Ansichten: Lageplan, vier Ansichten, setzbare Schnitte, Axonometrie
- M7 Dossier-PDF (Vektor) mit Plankopf
- M8 IFC4-Export; Archicad-Bridge mit Mock, Tests und UI
- M9 Persistenz (Autosave, Datei), Docker

**Should:** Varianten + Vergleich · editierbare temporäre Bemaßung · Grundrisse je Ebene · Abstandsflächen (vereinfacht; Default 0,4 H, mindestens 3 m, Faktor konfigurierbar; Prüfung auf Grundstück und gegenseitige Überdeckung) · Sonne/Schatten · Orthofoto-Unterlage · Archicad-Skript-Export · DXF-Export · Regelwerk-Profil FR · Constraints-Import · i18n FR/EN · „Typ bearbeiten“

**Could:** CityJSON-Import der Umgebung · Geländehöhe per Höhen-API für die ±0,00-Kote · Schattenstudie als Bildserie · Dark Theme · 3D-Schnittbereich

**Phasen:**

| Phase | Inhalt |
|---|---|
| P0 | Gerüst: Monorepo, Lint/Test/Build-Skripte, Docker-Skelett, `docs/` |
| P1 | `core`: Datenmodell, Generatoren, `massToSolids`, Flächen/Kennzahlen/Typologien + Tests |
| P2 | App-Shell: Revit-Layout, Ribbon, Eigenschaften, Projektbrowser, Tabs, Statusleiste, Store, Undo, Persistenz |
| P3 | Geodaten: Server-Proxy, Provider, Dialog „Neues Projekt“, Umgebung |
| P4 | 3D-Ansicht, visuelle Stile, Navigationswürfel, Modellierwerkzeuge, Fangen, Griffe |
| P5 | Tabellen und Exporte |
| P6 | `drawing`: Engine, Lageplan, Ansichten, Schnitte, Axonometrie (+ Tests), Live-Ansichten in der UI |
| P7 | Dossier-PDF |
| P8 | IFC-Export, Archicad-Bridge, Mock, UI |
| P9 | Should-Features |
| P10 | Härtung: E2E, Screenshots, README (Deutsch), Doku, Docker-Test; Could-Features nur bei verbleibender Zeit |

---

## 19. Definition of Done

- [ ] `docker compose up --build` → App läuft unter `http://localhost:8080`
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e` grün
- [ ] Alle Must-Features funktionieren durchgängig ohne Konsolenfehler
- [ ] Referenzfall aus §17 erscheint exakt so in der Flächentabelle der UI
- [ ] Dossier-PDF: Vektor, Plankopf, Maßstab nachmessbar korrekt
- [ ] IFC lädt in ifcopenshell; Storeys, Spaces und Flächen stimmen
- [ ] Bridge gegen Mock getestet (push, replace, dry-run)
- [ ] README auf Deutsch: Funktionsumfang, Start, Konfiguration der Geodienste, Archicad-Setup (Tapir + Bridge), bekannte Grenzen
- [ ] `docs/ARCHITECTURE.md`, `DECISIONS.md`, `KNOWN_LIMITATIONS.md` und Screenshots vorhanden
- [ ] Abschlusszusammenfassung: umgesetzt / nicht umgesetzt / nächste Schritte

---

## 20. Nicht-Ziele

- Kein vollwertiges BIM: keine Wände, Öffnungen oder Detailgrundrisse
- Keine Geländemodellierung (Gelände eben)
- Kein amtlicher Lageplan, keine Rechtsverbindlichkeit der Kennzahlen
- Keine Benutzerverwaltung, kein Cloud-Sync
- Keine Autodesk- oder Graphisoft-Assets
