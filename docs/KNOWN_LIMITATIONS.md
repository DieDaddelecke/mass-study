# Bekannte Grenzen

- **Cloud-Entwicklungsumgebung ohne Geodienste:** Die Build-/Test-Umgebung erreicht IGN, Overpass und OpenFreeMap nicht. Tests der Geodienste laufen mit aufgezeichneten Antworten; Live-Prüfung erfolgt im Browser des Auftraggebers (am 21.11.2026 für Palaiseau erfolgreich).
- **Docker:** Image-Build in der Entwicklungsumgebung nicht ausführbar (kein Docker-Daemon). Der Produktions-Server-Build (`pnpm deploy`) wurde lokal gestartet und geprüft.
- **Rücksprung je Seite** bei Freiformen ist eine Bounding-Box-Näherung (siehe DECISIONS #7).
- **Surface de plancher** ist eine Näherung ohne Trémies, Treppen, Höhen < 1,80 m und Kellerabzüge.
- **Gebäudeklasse / Aufzug / Rettungsweg (DE)** vereinfacht nach MBO; Landesrecht prüfen.
- **Gelände** ist eben (±0,00).
