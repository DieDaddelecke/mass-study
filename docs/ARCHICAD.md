# Archicad-Anbindung (Live-Link)

Die Kubatur-App überträgt die aktive Variante als native Archicad-Elemente in ein geöffnetes Archicad-Projekt. Der IFC-Export (separat) bleibt der Weg ohne Installation.

## Warum eine lokale Bridge?

Archicads JSON-API (`http://127.0.0.1:19723`, weitere Instanzen bis 19744) sendet keine CORS-Header. Ein Browser darf sie deshalb nicht direkt aufrufen (live geprüft mit Archicad 28, Build 3110). `tools/archicad-bridge/bridge.py` läuft auf dem Rechner der Architektin, nimmt Anfragen der Web-App an und leitet sie an Archicad und das Add-on **Tapir** (≥ 2.0.0) weiter.

```
Browser (Kubatur)  ──HTTP + Code──▶  bridge.py 127.0.0.1:19780  ──JSON──▶  Archicad + Tapir
```

## Einrichtung

1. Archicad (25 oder neuer) mit dem Add-on Tapir 2.x installieren: https://github.com/ENZYME-APD/tapir-archicad-automation (Releases) oder über den Graphisoft-Marketplace.
2. Python ≥ 3.10 installieren (nur Standardbibliothek, keine Pakete nötig).
3. Bridge starten:
   ```bash
   python tools/archicad-bridge/bridge.py
   # andere App-Adresse erlauben (z. B. Büroserver):
   python tools/archicad-bridge/bridge.py --origin http://kubatur.buero.local:8080
   ```
   Die Konsole zeigt den **Pairing-Code** (z. B. `K7QM-2XPA`). Er wird in `%APPDATA%\kubatur\bridge-token` bzw. `~/.config/kubatur/bridge-token` gespeichert und bleibt gleich; `--new-token` erzeugt einen neuen.
4. In der App: Registerkarte **Archicad › Connecter** (oder Befehlspalette), Code eingeben, Archicad-Projekt wählen, Vorschau prüfen, **Transférer**.

Standardmäßig erlaubte Origins: `http://localhost:5173`, `:8787`, `:8080` (jeweils auch `127.0.0.1`). Weitere per `--origin` oder `KUBATUR_ORIGINS` (kommagetrennt).

### Browser-Hinweise

- **Chrome/Edge:** Ruft eine App von einer anderen Adresse als `localhost` die Bridge auf, fragt der Browser einmal nach der Erlaubnis für „Apps und Dienste auf diesem Gerät“ (Local Network Access). Die Bridge beantwortet den Preflight mit `Access-Control-Allow-Private-Network: true`.
- **Safari** blockiert Aufrufe von HTTPS-Seiten an `http://127.0.0.1`. Mit Safari die App über `http://localhost` nutzen.

## Was übertragen wird

Seit dem Umbau auf **native Archicad-Elemente** entsteht standardmäßig ein echtes Gebäudemodell; Morphs sind nur noch eine Option (Volumenstudie) und der Ausweichweg.

| Kubatur                                                     | Archicad                                                                                                                                                                | Tapir                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Wohnung des Geschossplans                                   | **Zone** je Wohnung: Name = Typ (T2, T3 …), Nummer `<Baukörper>-<Geschoss>-01`, Kategorie `MS - <Nutzung>`                                                              | `CreateZones`                                                                                              |
| Treppenhaus, Flur/Laubengang, offene Fläche (Gewerbe, Büro) | **Zone** „Cage d'escalier“ / „Circulations“ (Kategorie `MS - Circulations`) bzw. Nutzung                                                                                | `CreateZones`                                                                                              |
| Geschoss eines Baukörpers                                   | **SDP-Zone** je Geschoss (ganze Geschossfläche, Kategorie `MS - SDP`, Nummer `MS-<Baukörper>-<Geschoss>-SDP`); überlappt die Wohnungszonen absichtlich (`allowOverlap`) | `CreateZones`                                                                                              |
| Fassade                                                     | **Wände** auf der Mittellinie, Außenseite bündig mit dem Umriss (Dicke einstellbar, 0,20 m); oberstes Geschoss bei Flachdach bis Oberkante Attika                       | `CreateWalls`                                                                                              |
| Wohnungsgrenzen, Treppenhaus, Flure                         | **Innenwände** auf den gemeinsamen Kanten (Trennwände 0,18 m, Treppenhaus 0,20 m), ohne Doppelwände                                                                     | `CreateWalls`                                                                                              |
| Ebenen                                                      | **Decke** je Ebene (Oberkante = OKFF, Umriss = Geschoss darunter ∪ darüber), Dachdecke über dem obersten Geschoss, **Treppenloch** ausgespart                           | `CreateSlabs`                                                                                              |
| Sattel-, Walm-, Pultdach                                    | **Dach** je Dachfläche (einschalig, Drehachse an der Traufe, Neigung)                                                                                                   | `CreateRoofs`                                                                                              |
| Treppe im Treppenhaus                                       | **Treppe** zweiläufig mit Zwischenpodest (U-Form: Lauf, Podest, Lauf); lehnt Archicad sie ab, Läufe und Podest als Morphs                                               | `CreateStairs` (sonst `CreateMorphs`)                                                                      |
| Geschossvolumen (Option)                                    | **Morph** (geschlossener Körper, Höfe ausgespart)                                                                                                                       | `CreateMorphs`                                                                                             |
| –                                                           | Ebene `MS - Massenstudie` für alle Elemente                                                                                                                             | `CreateLayers`, `layerIndex` (Decken, Wände, Morphs), `SetLayerOfElementDefaults` (Zonen, Treppen, Dächer) |
| Projekt-ID                                                  | unsichtbare Element-Benutzerdaten `kubatur.projectId`, `kubatur.item`, `kubatur.rev`                                                                                    | `SetElementUserData`                                                                                       |

**Geschosse:** Jede Ebene kommt auf das höchste Archicad-Geschoss, das auf oder unter ihr liegt; die Differenz wird als Versatz übernommen (Zone `bottomOffset`, Decke und Morph mit absoluter Höhe). Die Vorschau zeigt die Zuordnung und warnt bei Ebenen ohne passendes Geschoss. Fallen mehrere Ebenen auf dasselbe Geschoss, überlappen ihre Zonen und Archicad lehnt sie ab (Warnung `sharedStory`); diese Zonen werden einzeln durch Morphs ersetzt.

**Archicad vorbereiten:** Passen die Geschosse nicht, schlägt der Dialog eine Geschossliste vor, in der jede App-Ebene ein eigenes Geschoss auf exakter Höhe bekommt (Geschosse darunter bleiben, überzählige darüber bleiben erhalten und werden nur bei Bedarf gemeinsam angehoben; es wird nie ein Geschoss entfernt). Übernommen wird sie erst nach einer zweiten Bestätigung und nur in einem **unbenannten Projekt** (Testprojekt); in einem gespeicherten Projekt erklärt der Dialog, wie man die Geschosse in Archicad selbst anpasst.

**Ebene der Zonen, Treppen und Dächer:** Tapir 2.0.0 kennt für `CreateZones`, `CreateStairs` und `CreateRoofs` keinen `layerIndex`; die Elemente landen auf der Standard-Ebene ihres Werkzeugs. In der Bürovorlage ist das „8 - ZONES_SDP“, und die ist ausgeblendet: Archicad verweigert dann Benutzerdaten, Ebenenwechsel und Löschen. Folge waren ungekennzeichnete Zonen, die beim Aktualisieren doppelt entstanden. Deshalb wird die Standard-Ebene dieser drei Werkzeuge nur für die Dauer der Übertragung auf `MS - Massenstudie` gestellt und danach zurückgesetzt. Schlägt das Kennzeichnen trotzdem fehl, meldet der Bericht jedes betroffene Element („not tagged“).

**Lage:** App-Koordinaten (Ursprung = Grundstücksschwerpunkt) plus Versatz X/Y und Drehung aus dem Dialog.

**Aktualisieren:** Im Modus „Remplacer“ werden zuerst alle Elemente mit derselben `kubatur.projectId` gelöscht, dann neu erzeugt. Andere Elemente werden nie angefasst.

**Zonenstempel:** Ohne ladbaren Zonenstempel lehnt Archicad jede Zone ab („Failed to create new Zone“). In der Bürovorlage verwenden alle Kategorien „Marque de zone 02 27“ aus der AC27-Bibliothek; ist in Archicad 28 keine Zonenstempel-Bibliothek geladen, findet `GetAvailableLibraryParts` (Typ `Room`) keinen einzigen Stempel. Die App prüft das beim Verbinden und warnt im Dialog („Bibliothèque Archicad 28 laden“). Ist ein Stempel geladen, bekommen die neuen `MS - …`-Kategorien diesen Stempel (`stampMainGuid`/`stampRevGuid`).

**Ausweichwege:** Lehnt Archicad alle Zonen ab, wird für jede SDP-Zone ein Geschossvolumen (Morph) erzeugt, damit das Geschoss nicht fehlt; der Dialog erklärt die Ursache. Lehnt Archicad eine Treppe ab, entstehen deren Läufe und Podest als Morphs.

## Sicherheitsregeln der Bridge

Unabhängig von der Web-App erzwungen (`bridge.py`, getestet in `test_bridge.py`):

- bindet nur an `127.0.0.1`; nur erlaubte Origins; jede Anfrage außer `/health` braucht den Pairing-Code;
- nur eine Positivliste von Tapir-Befehlen; `DeleteSelectedElements`, IFC-Operationen u. a. sind gesperrt;
- `SetStories` nur in einem unbenannten Nicht-Teamwork-Projekt und nie mit weniger Geschossen als vorhanden;
- `SetLayerOfElementDefaults` nur für das Zonenwerkzeug, nur auf eine `MS - `-Ebene und zurück auf genau die Ebene, die vorher eingestellt war;
- `DeleteElements` und `SetDetailsOfElements` nur für Elemente mit `kubatur.projectId`; bei `SetDetailsOfElements` nur Ebene und ID;
- Ebenen und Zonenkategorien nur mit Präfix `MS - ` und ohne Überschreiben bestehender.

## Endpunkte

| Methode | Pfad         |                                                                                          |
| ------- | ------------ | ---------------------------------------------------------------------------------------- |
| GET     | `/health`    | Name, Version, `authorized` (ohne Code erreichbar)                                       |
| GET     | `/instances` | laufende Archicad-Instanzen (Port, Version, Tapir-Version, Projektname)                  |
| POST    | `/call`      | `{ port, command, parameters }` – Tapir-Befehl oder `API.IsAlive` / `API.GetProductInfo` |

Die Übertragungslogik (Zuordnung, Befehle, Ausweichweg) liegt in der App (`apps/web/src/archicad/`), die Bridge prüft und leitet weiter. Die Vorschau im Dialog ist der Dry-Run.

## Tests

- `pnpm test` – Planung, Morph-Körper, Ausführung gegen einen In-Memory-Archicad (`apps/web/src/archicad/archicad.test.ts`).
- `python3 -m unittest discover -s tools/archicad-bridge` – Bridge gegen `mock_archicad.py` (CORS, Code, Positivliste, Löschschutz).
- `python tools/archicad-bridge/mock_archicad.py [--refuse-zones]` simuliert Archicad auf Port 19723 zum Ausprobieren ohne Archicad.

Live geprüft am 21.11.2026 mit Archicad 28 (3110) + Tapir 2.0.0 in einem leeren Projekt: Decken (absolute Höhe, Höfe), Morphs (Volumen exakt, z. B. 336 m² × 3,5 m = 1 176 m³), Ebene, Kategorien, Benutzerdaten, Ersetzen und Entfernen. Zonen wurden in der verwendeten Bürovorlage von Archicad abgelehnt (fehlender Zonenstempel) – der Ausweichweg griff wie vorgesehen. Am selben Tag mit geladener Bibliothek: Geschosse angepasst (17 Geschosse bleiben 17), 8 Zonen auf eigenen Geschossen auf `MS - Massenstudie` erzeugt und gekennzeichnet, Ersetzen (8 gelöscht, 8 neu, keine Duplikate) und Entfernen; Standard-Ebene des Zonenwerkzeugs danach wieder „8 - ZONES_SDP“.

Live geprüft am 22.11.2026 (Archicad 28, Tapir 2.0.0, leeres Projekt aus der Bürovorlage): `CreateWalls` (Mittellinie, Höhe, Dicke), `CreateStairs` als U-Treppe Lauf/Podest/Lauf (18 Steigungen, 3,00 m, Laufbreite 1,20 m), `CreateRoofs` einschalig (30°, Drehachse), Ebene über die Werkzeug-Standards, Benutzerdaten und Löschen. Zonen scheiterten am fehlenden Zonenstempel (siehe oben).

## Grenzen

- Kein Rückweg Archicad → App (geplant: `CaptureElementState` / `GetElementChangesSince`).
- Geschosse werden nur im unbenannten Testprojekt automatisch angepasst.
- Flächen: Die Zone zeigt die Polygonfläche (z. B. 1 165,66 m²); die „berechnete Fläche“ in Archicad folgt den Flächenregeln der Vorlage (Abzüge, Raumhöhen) und kann kleiner sein (1 049,09 m²). Eine Decke mit Oberkante auf dem Rohbau kann leicht abweichen. Maßgeblich für die App-Kennzahlen ist die Polygonfläche.
- Teamwork: Elemente müssen reservierbar sein; Fehler werden je Element gemeldet.
- Skript-Export (Übertragung ohne laufende Bridge) noch nicht umgesetzt.
- Fenster, Türen, Balkone/Loggien und die Innenaufteilung der Wohnungen (Zimmer) werden noch nicht übertragen; Aufzugsschächte nur als Zone des Treppenhauses.
- Archicad legt die Stufen einer Treppe selbst nach seinen Treppenregeln aus; Steigungszahl und Podesttiefe können leicht von der App abweichen.
