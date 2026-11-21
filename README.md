# Kubatur

Web-App für städtebauliche Massenstudien / études de capacité: Grundstück wählen, Baukörper anordnen, Geschosse einstellen und live Flächen, Kennzahlen und Typologien erhalten – mit Plansatz (PDF), IFC-Export und Archicad-Anbindung.

> Stand: Phase P0–P1 (Gerüst und Rechenkern). Die Oberfläche folgt in P2–P4.

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

## Struktur

```
apps/web        Vite + React (Oberfläche, Französisch als Standard)
apps/server     Hono: Geodaten-Proxy + Cache, liefert den Web-Build aus
packages/core   Datenmodell, Bauformen, Geschosse, Flächen DIN 277, Kennzahlen FR/DE
docs/           SPEC, ARCHITECTURE, DECISIONS, KNOWN_LIMITATIONS
```

## Konfiguration (Server, ENV)

| Variable          | Default         | Bedeutung                      |
| ----------------- | --------------- | ------------------------------ |
| `PORT`            | 8080            | HTTP-Port                      |
| `STATIC_DIR`      | `../web/dist`   | Web-Build                      |
| `DATA_DIR`        | `./data`        | Cache der Geodaten             |
| `CACHE_TTL_DAYS`  | 30              | Cache-Lebensdauer              |
| `USER_AGENT`      | `Kubatur/0.1 …` | User-Agent für externe Dienste |
| `ALLOWED_ORIGINS` | –               | CORS-Origins für `/api/*`      |

Siehe `docs/` für Architektur, Entscheidungen und bekannte Grenzen.
