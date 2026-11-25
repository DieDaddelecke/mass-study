# Kubatur

Web-App für städtebauliche Massenstudien / études de capacité: Grundstück wählen, Baukörper anordnen, Geschosse einstellen und live Flächen, Kennzahlen und Typologien erhalten – mit Plansatz (PDF), IFC-Export und Archicad-Anbindung.

> Stand: Phasen P0–P4 – Rechenkern, Geodaten-Proxy, Revit-artige Oberfläche (Französisch), Dialog „Nouveau projet“ mit Karte und Kataster, 3D-Ansicht mit Modellierwerkzeugen. Offline-Demo: `http://localhost:5173/?demo=palaiseau`.

## Start

```bash
corepack enable
pnpm install
pnpm dev            # Web (Vite) + Server
pnpm test           # Unit-Tests
pnpm coverage       # Abdeckung core (≥ 80 %)
pnpm typecheck && pnpm lint && pnpm build
docker compose up --build   # http://localhost:8080
```

Die App läuft dann unter `http://localhost:5173`, die API auf Port 8787. Ist der Port belegt: `PORT=8788 pnpm dev` (PowerShell: `$env:PORT=8788; pnpm dev`). Unter Windows scheitert `corepack enable` ohne Adminrechte mit `EPERM`; dann `npm i -g pnpm@10.28.0`.

## Struktur

```
apps/web        Vite + React (Oberfläche, Französisch als Standard)
apps/server     Hono: Geodaten-Proxy + Cache, liefert den Web-Build aus
packages/core   Datenmodell, Bauformen, Geschosse, Flächen DIN 277, Kennzahlen FR/DE
docs/           SPEC, ARCHITECTURE, DECISIONS, KNOWN_LIMITATIONS
```

## Konfiguration (Server, ENV)

| Variable                                                         | Default         | Bedeutung                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                           | 8787            | HTTP-Port des Servers (Docker-Image: 8080). `pnpm dev` leitet `/api` von Vite an diesen Port weiter                                                                                                                                                         |
| `STATIC_DIR`                                                     | `../web/dist`   | Web-Build                                                                                                                                                                                                                                                   |
| `DATA_DIR`                                                       | `./data`        | Cache der Geodaten (`cache/`) und Kartenkacheln (`tiles/`)                                                                                                                                                                                                  |
| `CACHE_TTL_DAYS`                                                 | 30              | Cache-Lebensdauer                                                                                                                                                                                                                                           |
| `USER_AGENT`                                                     | `Kubatur/0.1 …` | User-Agent für externe Dienste                                                                                                                                                                                                                              |
| `ALLOWED_ORIGINS`                                                | –               | CORS-Origins für `/api/*`                                                                                                                                                                                                                                   |
| `PARCEL_WFS`                                                     | –               | JSON-Array generischer WFS-Flurstücksprovider (`id`, `url`, `typeName`, `coverage`, `fields.ref`, …), standardmäßig aus                                                                                                                                     |
| `OVERPASS_URLS`                                                  | 3 Instanzen     | Overpass-Endpunkte, kommagetrennt (Default: overpass-api.de, overpass.kumi.systems, maps.mail.ru); bei 429/502/503/504 wird der nächste versucht                                                                                                            |
| `RENDER_GEMINI_KEY`, `RENDER_STABILITY_KEY`, `RENDER_OPENAI_KEY` | –               | Optionale Server-Schlüssel für „Rendu IA“ (KI-Rendering der 3D-Ansicht). Ohne sie gibt jede Nutzerin ihren eigenen Schlüssel im Dialog ein (bleibt im Browser, wird pro Anfrage über `/api/render` an den Anbieter weitergereicht und nirgends gespeichert) |

**KI-Rendering („Rendu IA“):** Knopf mit Funken-Symbol in der Ansichtsleiste der 3D-Ansicht (auch unter „Sortie“ und Ctrl+K). Nimmt die aktuelle Ansicht auf, baut aus dem Projekt einen englischen Prompt (Nutzungen, Geschosse, Dächer, Balkone/Loggien, Ort, Ambiance), der vor dem Senden änderbar ist, und schickt beides an Google Gemini, Stability AI (Structure, ControlNet-artig) oder OpenAI. Jeder Aufruf ist beim Anbieter kostenpflichtig; der Dialog verlangt dafür eine Bestätigung.

Siehe `docs/` für Architektur, Entscheidungen und bekannte Grenzen.
