# tekmar CLI

Bun CLI for the Rails-based tekmar tN4 Gateway web UI.

## Setup

```sh
bun install
cp .env.example .env
```

Authenticate with either `TEKMAR_LOGIN` and `TEKMAR_PASSWORD`, or set `TEKMAR_SESSION_COOKIE` to an existing `_tN4_gateway=...` cookie.

## Commands

```sh
bun run cli temperatures
bun run cli temperatures 9
bun run cli temperatures set-mode 9 1 --yes

bun run cli scenes
bun run cli scenes 1
bun run cli scenes set 1 --yes

bun run cli schedules
bun run cli schedules system-1
bun run cli schedules system-1 set --mode 0 --num-events 2 --wake 48 --sleep 0 --yes

bun run cli water
bun run cli water 1
bun run cli water reset-runtime --id 0 --type boiler --yes
bun run cli water reset-energy-runtime --yes

bun run cli graphs
bun run cli graphs csv --out graph.csv
```

Write commands require `--yes`.

