#!/usr/bin/env node
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createDaemon } from "./daemon.js";

const port = Number(process.env.PORT ?? process.env.TEKMAR_DAEMON_PORT ?? 7348);
const hostname = process.env.HOST ?? process.env.TEKMAR_DAEMON_HOST ?? "127.0.0.1";
const daemon = createDaemon();

await daemon.handle(new Request("http://localhost/health"));

const server = createServer(async (incoming, outgoing) => {
  try {
    const request = await toRequest(incoming);
    const response = await daemon.handle(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) outgoing.write(chunk);
    }
    outgoing.end();
  } catch (error) {
    outgoing.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, hostname, () => {
  console.log(`tekmar daemon listening on http://${hostname}:${port}`);
});

async function toRequest(incoming: import("node:http").IncomingMessage): Promise<Request> {
  const protocol = (incoming.socket as { encrypted?: boolean }).encrypted ? "https" : "http";
  const host = incoming.headers.host ?? `${hostname}:${port}`;
  const url = `${protocol}://${host}${incoming.url ?? "/"}`;
  const body = incoming.method === "GET" || incoming.method === "HEAD" ? undefined : Readable.toWeb(incoming) as unknown as BodyInit;
  const init: RequestInit & { duplex?: "half" } = {
    method: incoming.method,
    headers: incoming.headers as HeadersInit,
    body,
    duplex: body ? "half" : undefined,
  };
  return new Request(url, init);
}
