#!/usr/bin/env bun
import { createDaemon } from "./daemon";

const port = Number(Bun.env.PORT ?? Bun.env.TEKMAR_DAEMON_PORT ?? 7348);
const hostname = Bun.env.HOST ?? Bun.env.TEKMAR_DAEMON_HOST ?? "127.0.0.1";
const daemon = createDaemon();

await daemon.handle(new Request("http://localhost/health"));

Bun.serve({
  hostname,
  port,
  fetch: (request) => daemon.handle(request),
});

console.log(`tekmar daemon listening on http://${hostname}:${port}`);
