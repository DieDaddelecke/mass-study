# Bekannte Grenzen

- **Cloud-Entwicklungsumgebung ohne Geodienste:** Die Build-/Test-Umgebung erreicht IGN, Overpass und OpenFreeMap nicht. Tests der Geodienste laufen mit aufgezeichneten Antworten; Live-Prüfung erfolgt im Browser des Auftraggebers (am 21.11.2026 für Palaiseau erfolgreich).
- **Docker:** Image-Build in der Entwicklungsumgebung nicht ausführbar (kein Docker-Daemon). Der Produktions-Server-Build (`pnpm deploy`) wurde lokal gestartet und geprüft.
- **Rücksprung je Seite** bei Freiformen ist eine Bounding-Box-Näherung (siehe DECISIONS #7).
- **Surface de plancher** ist eine Näherung ohne Trémies, Treppen, Höhen < 1,80 m und Kellerabzüge.
- **Gebäudeklasse / Aufzug / Rettungsweg (DE)** vereinfacht nach MBO; Landesrecht prüfen.
- **Gelände** ist eben (±0,00).
- **Geodaten-Proxy (apps/server):** Abdeckung „Frankreich“ (API Carto, BD TOPO) ist eine grobe Bounding-Box des Mutterlands inkl. Korsika; DOM/TOM werden nicht als abgedeckt erkannt (→ OSM/Nominatim). Geokodierung: IGN zuerst, Nominatim nur wenn IGN nichts findet; Autovervollständigung nur über IGN (Nominatim-Richtlinie verbietet Autocomplete). Nominatim-Antwortformat nur gegen eine synthetische Fixture getestet (nicht live verifiziert).
- **Generischer WFS-Flurstücksprovider:** nur mit synthetischer Fixture getestet, kein Land verifiziert und standardmäßig deaktiviert (`PARCEL_WFS`). Keine Umprojektion: der Dienst muss GeoJSON in EPSG:4326 liefern.
- **2D-Zeichnungen:** Grundrisse je Ebene, Bemaßung im Lageplan, Abstandsflächen, Legende, Kartenunterlage, Ansicht „am Grundstück ausrichten“, frei gesetzte Schnittlinien und DXF-Export fehlen noch. Füllungen der Axonometrie sind maler-sortiert (bei verschachtelten Körpern sind Farbfehler möglich, die Linien bleiben exakt). Sich durchdringende Baukörper werden nur per Abtastung (1 m + Bisektion) behandelt. Gelände ist eben (z = 0).
- **Tabellen, Varianten, Ausgabe, Archicad** sind in der Oberfläche sichtbar deaktiviert („en préparation“) und folgen in P5–P8.
- **3D:** Sonnenstand nach Ort/Datum und BVH-Picking fehlen noch; 50 fps bei 2.000 Nachbarn nicht gemessen (Kontext ist zusammengeführt, Baukörper je Geschoss ein Mesh). Beim Ziehen eines Griffs zeigt die Szene bis zum Loslassen nur eine Vorschau-Kontur.
- **Werkzeuge:** Ausrichten (AL), Grundstück und Nachbargebäude im Modell zeichnen sind noch nicht umgesetzt; temporäre Bemaßung folgt mit den 2D-Ansichten.
- **DXF-Import:** Bögen in Polylinien werden als gerade Segmente übernommen.
- **„Enregistrer sous“** fragt den Dateinamen per Browser-Dialog ab.
- **Kontext-Layer:** Einzelbäume kommen nur aus OSM (Overpass); am 21.11.2026 war Overpass samt Spiegeln überlastet (502/504), die OSM-Grün-/Baum-Abbildung ist daher nur gegen eine synthetische Fixture getestet. Bäume in Wäldern/Parks werden gestreut (DECISIONS #22). Parzellennummern werden in 3D noch nicht beschriftet (Schrift müsste mitgeliefert werden). Linienförmige Hecken aus BD TOPO werden ignoriert.
- **Oberfläche:** Fang ein/aus und Koordinatenanzeige der alten Statusleiste entfallen vorerst (Fang selbst funktioniert). Ziel ist Desktop ab 1.200 px; darunter starten die Panels eingeklappt.
