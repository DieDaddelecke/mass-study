# Architektur

## Module

| Paket                   | Zweck                                                                                                                                              | Stand                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/core`         | Datenmodell, Bauform-Generatoren, Geschosslogik, Flächen (DIN 277), Kennzahlen DE/FR, Typologien, Wohnungsmix, Prüfungen, Projektion, Projektdatei | P1 fertig                                                         |
| `packages/drawing`      | 2D-Zeichnungsmodell, verdeckte Kanten, Schnitte, SVG/DXF                                                                                           | P6                                                                |
| `packages/ifc`          | IFC4-STEP-Writer (`StepWriter`, IFC-GUIDs, `exportIfc(project, variantResult, options)`) – Projekt › Site › Gebäude › Geschosse › Räume/Decken     | P5: IFC4-Export                                                   |
| `apps/web`              | Vite + React SPA                                                                                                                                   | P2–P4: Oberfläche, Dialog „Nouveau projet“, 3D-Ansicht, Werkzeuge |
| `apps/server`           | Hono: Geodaten-Proxy + Cache, liefert den Web-Build aus                                                                                            | P3: Geodaten-Proxy (IGN, API Carto, BD TOPO, Overpass, Nominatim) |
| `tools/archicad-bridge` | Python-Bridge + Mock-Archicad                                                                                                                      | P8                                                                |

## Datenfluss

```
Project (JSON, *.massing.json)
  └─ Variant.masses: Mass[]                 (Eingabe: Bauform + Lage + Geschossstapel)
        │  typologySegments()                Bauform → Abschnitte (lokale Footprints)
        │  massToSolids()                    Abschnitte × Geschosse → StoreySolid[]
        ▼
  StoreySolid[]  ── einzige Quelle für 3D, Flächen, Zeichnungen, IFC und Archicad
        │  analyzeMass() / analyzeMasses()   DIN 277 je Solid, Höhen, Vollgeschosse,
        │                                    Erschließung, Kerne, Wohnungsmix, Stellplätze
        ▼
  VariantResult ─► kpisDE() / kpisFR() ─► constraintRows() ─► modelWarnings()
        └──────────────── analyzeProject() bündelt alles für die UI
  ProjectAnalysis ─► surfaces/kpi/typology/comparisonSchedule()  (schedules.ts: neutrales
                     Tabellenmodell mit i18n-Schlüsseln und Summenverweisen für UI, XLSX, CSV, PDF)
```

## Zentrale Typen (`packages/core/src/types.ts`)

- `Polygon { outer, holes? }` – außen CCW, Löcher CW, offene Ringe, lokale Meter.
- `Mass` – Bauform (`Typology`, Discriminated Union), `position`, `rotation`, `storeys: StoreyStack`, Abschnitts-Overrides, Nutzung je Geschoss, Erschließung.
- `StoreySolid` – ein Geschoss eines Abschnitts: Footprint in Projektkoordinaten, `z0`/`z1` (OKFF bis OKFF), Nutzung, Staffel-/Dachgeschoss-Flags.
- `Settings` – Regelwerk-Profil (`FR` | `DE`), Notation, alle editierbaren Kennwerte.
- `Project` – Georeferenz (`geo.crs`, `originCrs`), Grundstück, Umgebung, Varianten, Einstellungen, Vorgaben.

## Koordinaten

Lokales metrisches System (x Ost, y Nord, z oben), Ursprung im Schwerpunkt des Grundstücks. `projection.ts` wählt das Landessystem (FR: EPSG:2154, DE: EPSG:25832/25833, sonst UTM) und rechnet lon/lat ↔ lokal. CRS und Ursprung stehen im Projekt (für IFC, DXF, Archicad).

## Geometrie

`geometry.ts` kapselt Clipper2 (`clipper2-ts`, Präzision 0,1 mm) für Vereinigung, Schnitt, Differenz und Versatz mit Gehrung. Alles andere (Flächen, Umfang, Schwerpunkt, Inkreis via `polylabel`, orientierte Ausdehnung) ist eigener, reiner Code.

## Prinzipien

- `core` ist reines TypeScript ohne DOM, läuft in Node und im Web Worker, deterministisch, `any`-frei.
- Abgeleitete Werte werden nie gespeichert, sondern immer aus `Mass` neu berechnet.

## Zeichnungen (`packages/drawing`)

Reines TypeScript ohne DOM (läuft in Node für das PDF-Dossier). `StoreySolid[]` + Projekt → neutrales `DrawingModel` (Linien mit Stift 1–6 und Linientyp, Füllungen mit Schraffur, Texte in mm, Bemaßungen, Symbole Nordpfeil/Maßstabsleiste/Kote/Schnittkopf; Modellkoordinaten in m) → `renderSvg(model, { scale })` (SVG in echten mm).

- `sitePlan` (Lageplan), `elevation` (N/O/S/W), `section` (Schnittlinie + Tiefe, Poché), `axonometry` (SW/SO/NO/NW, Isometrie oder Grundriss-Axonometrie); `drawingInput(result)` liefert Solids, Ebenen und Attika/Formel je Baukörper aus der Analyse; `defaultSections` A/B durch den Grundstücksschwerpunkt.
- `hidden.ts`: exakte Verdeckung für senkrechte Prismen bei Parallelprojektion (DECISIONS #27), Maler-sortierte Füllungen darunter.
- `svg.ts`: Stifttabelle, `chooseScale(model, w, h)` (Normmaßstäbe), `measureDrawing`.

## Web-App (`apps/web/src`)

| Ordner            | Inhalt                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store/`          | `projectStore` (Projekt, immer-Rezepte, Undo/Redo via zundo), `uiStore` (Auswahl, Werkzeug, Ansicht, Fang), `useAnalysis` (Live-Berechnung)                                                                                                                                                                                                                                                                                     |
| `shell/`          | Moderne Web-App-Oberfläche: Kopfleiste, Werkzeugleiste, linkes Panel (Projekt/Calques/Vues), Inspektor, Werkzeug-Pille, Kennzahlen-Karten, Befehlssuche (Strg+K), Toasts, Dialoge, Tastenkürzel                                                                                                                                                                                                                                 |
| `persistence/`    | Autosave (IndexedDB), Öffnen/Speichern `.massing.json`                                                                                                                                                                                                                                                                                                                                                                          |
| `viewport/`       | 3D-Szene (R3F, z oben), visuelle Stile, Navigationswürfel, Ansichtssteuerleiste; `scene/Surroundings` (Straßen, Grün, Bäume, Wasser, Nachbarparzellen), `scene/Basemap` (IGN-Kacheln am Boden)                                                                                                                                                                                                                                  |
| `viewport/tools/` | Platzieren, Fangen, MV/RO/CO/MM/AR, Griffe; `capabilities.ts` steuert, welche Ribbon-Befehle aktiv sind                                                                                                                                                                                                                                                                                                                         |
| `newProject/`     | Dialog „Nouveau projet“: Adresse, Karte (MapLibre), Parzellen, Zeichnen, Import GeoJSON/DXF, Kontext laden                                                                                                                                                                                                                                                                                                                      |
| `api/`            | HTTP-Vertrag mit dem Server (`contract.ts`) und Client                                                                                                                                                                                                                                                                                                                                                                          |
| `i18n/`           | i18next, Französisch Standard; ein Namespace je Modul                                                                                                                                                                                                                                                                                                                                                                           |
| `theme/`          | Design-Tokens (`tokens.css`), Szenenpalette (`palette.ts`), hell/dunkel/System (`themeStore.ts`)                                                                                                                                                                                                                                                                                                                                |
| `tables/`         | Tabellen-Arbeitsbereich (Ansicht „Surfaces“): Flächen, Kennzahlen, Typologien, Variantenvergleich; Gruppen einklappbar, Zeilenklick wählt den Baukörper; `tablesStore` (Reiter, Exporte, `?schedule=`)                                                                                                                                                                                                                          |
| `exports/`        | Downloads (`download.ts`); `ifc.ts` + `IfcExportDialog.tsx`: IFC4-Export der aktiven Variante, Writer per `import()` nachgeladen; `xlsx.ts` (ein Blatt je Tabelle, SUMME-Formeln, Zahlenformate, fixierte Kopfzeile, Bibliothek per `import()`); `csv.ts` (`;`, Dezimalkomma fr/de, UTF-8-BOM, TSV für die Zwischenablage)                                                                                                      |
| `demo/`           | Offline-Demoprojekt `?demo=palaiseau` aus aufgezeichneten echten Daten                                                                                                                                                                                                                                                                                                                                                          |
| `drawings/`       | 2D-Ansichten aus `@kubatur/drawing`: `buildDrawing` (Ansicht → Modell), `DrawingView` (Papierblatt, Pan/Zoom, Maßstab, Farbschema, SVG-Download); Dev-Parameter `&view=site` öffnet eine Ansicht                                                                                                                                                                                                                                |
| `dossier/`        | Plansatz-PDF (SPEC §12): `views.ts` (Naht zu `@kubatur/drawing`: `PlanView` = SVG in mm + Maßstab, Auto-Maßstab je Gruppe), `sheets.ts` (Blätter A3/A2/A1 als SVG: Rahmen, Ansichten mit Titel/Nummer/Maßstab/Maßstabsleiste, Plankopf 180 × 60 mm, Deckblatt, paginierte Tabellen aus `core/schedules`), `pdf.ts` (jsPDF + svg2pdf.js per `import()`, Inter-TTF eingebettet), `DossierDialog.tsx` (Optionen, Vorschau, Export) |

## IFC-Export (`packages/ifc`)

- `step.ts`: ISO-10303-21-Writer; Werte werden als fertige Tokens übergeben (`str`, `real`, `enumv`, `list`, `typed`), Strings ASCII mit `\X2\…\X0\`.
- `guid.ts`: 22-stellige IFC-GUIDs; mit `guidSeed` deterministisch (Web-App: Projekt-ID + Variante → stabile IDs für Archicad-Hotlink/Neu-Import).
- `export.ts`: IfcProject (m, m², m³, rad) › IfcSite (Parzellen als FootPrint, RefLatitude/RefLongitude des lokalen Ursprungs, IfcMapConversion + IfcProjectedCRS) › IfcBuilding „{Étude de capacité} – {Variante}“ › IfcBuildingStorey je `VariantResult.levels` › IfcSpace je StoreySolid (IfcRelAggregates, Body = Extrusion, Profil mit Voids bei Höfen, Qto_SpaceBaseQuantities, Pset_SpaceCommon, Pset_Massenstudie). Optional IfcSlab/IfcBuildingElementProxy (IfcRelContainedInSpatialStructure im Geschoss) und Kontext-Proxies im Site.
- Geometrie in projektlokalen Metern; lokaler Ursprung = `geo.originCrs`, keine Drehung (x = Ost), z = 0 = ±0,00 = `geo.groundElevation`.
- Tests parsen die Datei mit `web-ifc` (WASM in Node, `SetWasmPath(<node_modules/web-ifc>/, true)`).
