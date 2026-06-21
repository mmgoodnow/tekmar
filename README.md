# tekmar-homekit

Standalone HomeKit bridge for the Rails-based tekmar tN4 Gateway web UI.

The app logs into the existing Tekmar Gateway website, reads thermostat zones, and advertises a single HomeKit bridge with one thermostat accessory per zone. Apple Home owns rooms, scenes, automations, and grouping.

## Setup

```sh
npm install
cp .env.example .env
```

Set `TEKMAR_BASE_URL` to the gateway origin. Authenticate with either `TEKMAR_LOGIN` and `TEKMAR_PASSWORD`, or set `TEKMAR_SESSION_COOKIE` to an existing `_tN4_gateway=...` cookie.

## Run From Source

```sh
npm run homekit
```

Useful environment variables:

```text
TEKMAR_BASE_URL=
TEKMAR_LOGIN=
TEKMAR_PASSWORD=
TEKMAR_SESSION_COOKIE=
TEKMAR_HOMEKIT_NAME=Tekmar
TEKMAR_HOMEKIT_PIN=031-45-154
TEKMAR_HOMEKIT_BIND=en0
TEKMAR_HOMEKIT_STORAGE=~/.tekmar-homekit
```

`TEKMAR_HOMEKIT_BIND` is optional. By default the bridge chooses the first active physical Mac interface, usually `en0`.

## Build

Build TypeScript:

```sh
npm run build
```

Build a single-file Apple Silicon binary:

```sh
SEA_TARGETS=darwin-arm64 npm run build:sea
```

Build and notarize after installing a `Developer ID Application` certificate and creating the `notarytool` profile:

```sh
SEA_TARGETS=darwin-arm64 NOTARY_PROFILE=tekmar npm run build:sea
```

`Apple Development` certificates can sign a local development binary, but Apple notarization requires a `Developer ID Application` certificate.

## Release Binary Usage

Download `tekmar-homekit-darwin-arm64.zip`, unzip it, and run:

```sh
./tekmar-homekit-darwin-arm64 --base-url "https://PASTE-TEKMAR-URL-HERE" --login "PASTE-LOGIN-HERE" --password "PASTE-PASSWORD-HERE"
```

Leave the terminal window open. If the laptop sleeps or the process exits, the HomeKit bridge stops.

Pair in Apple Home with code `031-45-154`.
