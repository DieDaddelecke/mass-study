# Bekannte Grenzen

- **Cloud-Entwicklungsumgebung ohne Geodienste:** Die Build-/Test-Umgebung erreicht IGN, Overpass und OpenFreeMap nicht. Tests der Geodienste laufen mit aufgezeichneten Antworten; Live-Prüfung erfolgt im Browser des Auftraggebers (am 21.11.2026 für Palaiseau erfolgreich).
- **Docker:** Image-Build in der Entwicklungsumgebung nicht ausführbar (kein Docker-Daemon). Der Produktions-Server-Build (`pnpm deploy`) wurde lokal gestartet und geprüft.
- **Rücksprung je Seite** bei Freiformen ist eine Bounding-Box-Näherung (siehe DECISIONS #7).
- **Surface de plancher** ist eine Näherung ohne Trémies, Treppen, Höhen < 1,80 m und Kellerabzüge.
- **Gebäudeklasse / Aufzug / Rettungsweg (DE)** vereinfacht nach MBO; Landesrecht prüfen.
- **Gelände** ist eben (±0,00).
- **Geodaten-Proxy (apps/server):** Abdeckung „Frankreich“ (API Carto, BD TOPO) ist eine grobe Bounding-Box des Mutterlands inkl. Korsika; DOM/TOM werden nicht als abgedeckt erkannt (→ OSM/Nominatim). Geokodierung: IGN zuerst, Nominatim nur wenn IGN nichts findet; Autovervollständigung nur über IGN (Nominatim-Richtlinie verbietet Autocomplete). Nominatim-Antwortformat nur gegen eine synthetische Fixture getestet (nicht live verifiziert).
- **Generischer WFS-Flurstücksprovider:** nur mit synthetischer Fixture getestet, kein Land verifiziert und standardmäßig deaktiviert (`PARCEL_WFS`). Keine Umprojektion: der Dienst muss GeoJSON in EPSG:4326 liefern.
- **2D-Ansichten, Tabellen, Varianten, Ausgabe, Archicad** sind in der Oberfläche sichtbar deaktiviert („en préparation“) und folgen in P5–P8.
- **3D:** Sonnenstand nach Ort/Datum und BVH-Picking fehlen noch; 50 fps bei 2.000 Nachbarn nicht gemessen (Kontext ist zusammengeführt, Baukörper je Geschoss ein Mesh). Beim Ziehen eines Griffs zeigt die Szene bis zum Loslassen nur eine Vorschau-Kontur.
- **Werkzeuge:** Ausrichten (AL), Grundstück und Nachbargebäude im Modell zeichnen sind noch nicht umgesetzt; temporäre Bemaßung folgt mit den 2D-Ansichten.
- **DXF-Import:** Bögen in Polylinien werden als gerade Segmente übernommen.
- **„Enregistrer sous“** fragt den Dateinamen per Browser-Dialog ab.
- **Kontext-Layer:** Einzelbäume kommen nur aus OSM (Overpass); am 21.11.2026 war Overpass samt Spiegeln überlastet (502/504), die OSM-Grün-/Baum-Abbildung ist daher nur gegen eine synthetische Fixture getestet. Bäume in Wäldern/Parks werden gestreut (DECISIONS #22). Parzellennummern werden in 3D noch nicht beschriftet (Schrift müsste mitgeliefert werden). Linienförmige Hecken aus BD TOPO werden ignoriert.
- **Oberfläche:** Fang ein/aus und Koordinatenanzeige der alten Statusleiste entfallen vorerst (Fang selbst funktioniert). Ziel ist Desktop ab 1.200 px; darunter starten die Panels eingeklappt.
- **IFC-Export:** Nur die aktive Variante; keine Außenwände/Dächer/Attiken (Brüstung nur in GrossVolume der Analyse, nicht in der Geometrie); Geschosse über die Projekt-Ebenen, Baukörper mit abweichenden Geschosshöhen landen im nächstgelegenen Geschoss. Keine Gelände-/Straßen-/Baum-Geometrie, Kontextgebäude nur als Extrusion. Nur IFC4 (kein IFC2x3). Kein Validierungslauf mit ifcopenshell und kein Import-Test in Archicad selbst (nur `web-ifc`); Bezeichnungen der Archicad-Menüs im Hilfedialog aus der Dokumentation, nicht im Programm geprüft. CRS-Beschreibungen nur für Lambert-93 und UTM (ETRS89/WGS 84), sonst nur der EPSG-Name.
