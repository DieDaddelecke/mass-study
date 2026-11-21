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

| Kubatur                                 | Archicad                                                                                                        | Tapir                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Geschoss eines Baukörpers (StoreySolid) | **Zone**: Name = Nutzung, Nummer `MS-<Baukörper>-<Geschoss>`, Höhe, Kategorie `MS - <Nutzung>`, Höfe als Löcher | `CreateZones`                                                                      |
| dasselbe Volumen                        | **Morph** (geschlossener Körper, Höfe ausgespart)                                                               | `CreateMorphs`                                                                     |
| Geschossdecke (optional)                | **Decke** mit Oberkante auf OKFF, Dicke aus dem Geschossstapel                                                  | `CreateSlabs`                                                                      |
| –                                       | Ebene `MS - Massenstudie` für alle Elemente                                                                     | `CreateLayers`, `SetLayerOfElementDefaults` (Zonen), `layerIndex` (Decken, Morphs) |
| Projekt-ID                              | unsichtbare Element-Benutzerdaten `kubatur.projectId`, `kubatur.item`, `kubatur.rev`                            | `SetElementUserData`                                                               |

**Geschosse:** Jede Ebene kommt auf das höchste Archicad-Geschoss, das auf oder unter ihr liegt; die Differenz wird als Versatz übernommen (Zone `bottomOffset`, Decke und Morph mit absoluter Höhe). Die Vorschau zeigt die Zuordnung und warnt bei Ebenen ohne passendes Geschoss. Fallen mehrere Ebenen auf dasselbe Geschoss, überlappen ihre Zonen und Archicad lehnt sie ab (Warnung `sharedStory`); diese Zonen werden einzeln durch Morphs ersetzt.

**Archicad vorbereiten:** Passen die Geschosse nicht, schlägt der Dialog eine Geschossliste vor, in der jede App-Ebene ein eigenes Geschoss auf exakter Höhe bekommt (Geschosse darunter bleiben, überzählige darüber bleiben erhalten und werden nur bei Bedarf gemeinsam angehoben; es wird nie ein Geschoss entfernt). Übernommen wird sie erst nach einer zweiten Bestätigung und nur in einem **unbenannten Projekt** (Testprojekt); in einem gespeicherten Projekt erklärt der Dialog, wie man die Geschosse in Archicad selbst anpasst.

**Ebene der Zonen:** Tapir 2.0 kennt für `CreateZones` keinen `layerIndex`; Zonen landen auf der Standard-Ebene des Zonenwerkzeugs. In der Bürovorlage ist das „8 - ZONES_SDP“, und die ist ausgeblendet: Archicad verweigert dann Benutzerdaten, Ebenenwechsel und Löschen. Folge waren ungekennzeichnete Zonen, die beim Aktualisieren doppelt entstanden. Deshalb wird die Standard-Ebene der Zonen nur für die Dauer der Übertragung auf `MS - Massenstudie` gestellt und danach zurückgesetzt. Schlägt das Kennzeichnen trotzdem fehl, meldet der Bericht jedes betroffene Element („not tagged“).

**Lage:** App-Koordinaten (Ursprung = Grundstücksschwerpunkt) plus Versatz X/Y und Drehung aus dem Dialog.

**Aktualisieren:** Im Modus „Remplacer“ werden zuerst alle Elemente mit derselben `kubatur.projectId` gelöscht, dann neu erzeugt. Andere Elemente werden nie angefasst.

**Zonen-Ausweichweg:** Lehnt Archicad alle Zonen ab (typisch: der Zonenstempel der Vorlage liegt in einer nicht geladenen Bibliothek, z. B. „Bibliothèque Archicad 27“ in Archicad 28), werden stattdessen Morphs erzeugt und der Dialog erklärt die Ursache. Die Vorschau warnt bereits vorher, wenn Bibliotheken im Projekt nicht verfügbar sind.

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

## Grenzen

- Kein Rückweg Archicad → App (geplant: `CaptureElementState` / `GetElementChangesSince`).
- Geschosse werden nur im unbenannten Testprojekt automatisch angepasst.
- Flächen: Die Zone zeigt die Polygonfläche (z. B. 1 165,66 m²); die „berechnete Fläche“ in Archicad folgt den Flächenregeln der Vorlage (Abzüge, Raumhöhen) und kann kleiner sein (1 049,09 m²). Eine Decke mit Oberkante auf dem Rohbau kann leicht abweichen. Maßgeblich für die App-Kennzahlen ist die Polygonfläche.
- Teamwork: Elemente müssen reservierbar sein; Fehler werden je Element gemeldet.
- Skript-Export (Übertragung ohne laufende Bridge) noch nicht umgesetzt.
