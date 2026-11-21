# Bekannte Grenzen

- **Cloud-Entwicklungsumgebung ohne Geodienste:** Die Build-/Test-Umgebung erreicht IGN, Overpass und OpenFreeMap nicht. Tests der Geodienste laufen mit aufgezeichneten Antworten; Live-Prüfung erfolgt im Browser des Auftraggebers (am 21.11.2026 für Palaiseau erfolgreich).
- **Docker:** Image-Build in der Entwicklungsumgebung nicht ausführbar (kein Docker-Daemon). Der Produktions-Server-Build (`pnpm deploy`) wurde lokal gestartet und geprüft.
- **Rücksprung je Seite** bei Freiformen ist eine Bounding-Box-Näherung (siehe DECISIONS #7).
- **Surface de plancher** ist eine Näherung ohne Trémies, Treppen, Höhen < 1,80 m und Kellerabzüge.
- **Gebäudeklasse / Aufzug / Rettungsweg (DE)** vereinfacht nach MBO; Landesrecht prüfen.
- **Gelände** ist eben (±0,00).
- **Geodaten-Proxy (apps/server):** Abdeckung „Frankreich“ (API Carto, BD TOPO) ist eine grobe Bounding-Box des Mutterlands inkl. Korsika; DOM/TOM werden nicht als abgedeckt erkannt (→ OSM/Nominatim). Geokodierung: IGN zuerst, Nominatim nur wenn IGN nichts findet; Autovervollständigung nur über IGN (Nominatim-Richtlinie verbietet Autocomplete). Nominatim-Antwortformat nur gegen eine synthetische Fixture getestet (nicht live verifiziert).
- **Generischer WFS-Flurstücksprovider:** nur mit synthetischer Fixture getestet, kein Land verifiziert und standardmäßig deaktiviert (`PARCEL_WFS`). Keine Umprojektion: der Dienst muss GeoJSON in EPSG:4326 liefern.
