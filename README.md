# tekmar CLI

Bun CLI for the Rails-based tekmar tN4 Gateway web UI.

## Setup

```sh
bun install
cp .env.example .env
```

Set `TEKMAR_BASE_URL` to the gateway origin. Authenticate with either `TEKMAR_LOGIN` and `TEKMAR_PASSWORD`, or set `TEKMAR_SESSION_COOKIE` to an existing `_tN4_gateway=...` cookie.

## Commands

```sh
tekmar temperatures
tekmar temperatures 9
tekmar temperatures set-mode 9 1 --yes

tekmar scenes
tekmar scenes 1
tekmar scenes set 1 --yes

tekmar schedules
tekmar schedules system-1
tekmar schedules system-1 set --mode 0 --num-events 2 --occ 48 --unocc 0 --yes

tekmar water
tekmar water 1
tekmar water reset-runtime --id 0 --type boiler --yes
tekmar water reset-energy-runtime --yes

tekmar graphs
tekmar graphs csv --out graph.csv
```

Read commands print readable summaries by default. `tekmar temperatures` streams each room as it is loaded from the gateway. Add `--json` for buffered domain-shaped JSON, or `--raw` to inspect parsed forms, links, and tables while reverse engineering.

Write commands require `--yes`.

## Daemon

Run the local JSON API:

```sh
bun run daemon
```

By default it listens on `http://127.0.0.1:7348`. Set `TEKMAR_DAEMON_HOST`, `TEKMAR_DAEMON_PORT`, or `TEKMAR_CACHE_TTL_MS` to change the bind address, port, or read cache TTL.

Endpoints:

```text
GET /api/health
GET /api/temperatures
GET /api/temperatures/:id
PUT /api/temperatures/:id/mode        {"mode":"..."}
GET /api/scenes
GET /api/scenes/:id
PUT /api/scenes/active                {"id":"..."}
GET /api/schedules
GET /api/schedules/system-1
PUT /api/schedules/system-1           {"mode":"...","numEvents":"...","occ":"...","unocc":"..."}
GET /api/water-temperatures
GET /api/water-temperatures/:id
GET /api/graphs
GET /api/graphs.csv
```
