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
tekmar schedules system-1 set --mode 0 --num-events 2 --wake 48 --sleep 0 --yes

tekmar water
tekmar water 1
tekmar water reset-runtime --id 0 --type boiler --yes
tekmar water reset-energy-runtime --yes

tekmar graphs
tekmar graphs csv --out graph.csv
```

Read commands print readable summaries by default. Add `--json` for domain-shaped JSON, or `--raw` to inspect parsed forms, links, and tables while reverse engineering.

Write commands require `--yes`.
