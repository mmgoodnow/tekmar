import { TekmarClient } from "./client.js";
import {
  graphCsv,
  graphs,
  scenes,
  schedules,
  setScene,
  setSystemSchedule,
  setTemperatureMode,
  setTemperatureSetpoint,
  temperatures,
  waterTemperatures,
} from "./resources.js";

export type DaemonOptions = {
  client?: TekmarClient;
  now?: () => number;
  cacheTtlMs?: number;
};

type CacheEntry = {
  expiresAt: number;
  value: Promise<unknown>;
};

type JsonBody = Record<string, unknown>;

const DEFAULT_CACHE_TTL_MS = 5_000;

export class TekmarDaemon {
  private readonly client: TekmarClient;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private writeQueue: Promise<unknown> = Promise.resolve();
  private authentication: Promise<void> | undefined;

  constructor(options: DaemonOptions = {}) {
    this.client = options.client ?? new TekmarClient();
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = options.cacheTtlMs ?? numberEnv("TEKMAR_CACHE_TTL_MS") ?? DEFAULT_CACHE_TTL_MS;
  }

  async handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = stripApiPrefix(url.pathname);

      if (request.method === "GET" && path === "/health") {
        return json({ ok: true, cacheTtlMs: this.cacheTtlMs });
      }

      await this.ensureAuthenticated();
      const result = await this.route(request, path);
      return result instanceof Response ? result : json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("not found") ? 404 : message.includes("required") ? 400 : 500;
      return json({ ok: false, error: message }, status);
    }
  }

  private async route(request: Request, path: string): Promise<unknown> {
    const parts = path.split("/").filter(Boolean);
    const [resource, id, action] = parts;

    if (request.method === "GET" && resource === "temperatures") {
      return this.cached(`temperatures:${id ?? "list"}`, () => temperatures(this.client, id));
    }
    if (request.method === "PUT" && resource === "temperatures" && id && action === "mode") {
      const body = await jsonBody(request);
      const mode = stringField(body, "mode");
      return this.write(["temperatures:list", `temperatures:${id}`], async () => {
        await setTemperatureMode(this.client, id, mode);
        return { ok: true, id, mode };
      });
    }
    if (request.method === "PUT" && resource === "temperatures" && id && action === "setpoint") {
      const body = await jsonBody(request);
      const kind = setpointKind(body);
      const temperatureF = numberField(body, "temperatureF");
      return this.write(["temperatures:list", `temperatures:${id}`], async () => {
        await setTemperatureSetpoint(this.client, id, kind, temperatureF);
        return { ok: true, id, kind, temperatureF };
      });
    }

    if (request.method === "GET" && resource === "scenes") {
      return this.cached(`scenes:${id ?? "list"}`, () => scenes(this.client, id));
    }
    if (request.method === "PUT" && resource === "scenes" && id === "active") {
      const body = await jsonBody(request);
      const sceneId = stringField(body, "id");
      return this.write(["scenes:list"], async () => {
        await setScene(this.client, sceneId);
        return { ok: true, id: sceneId };
      });
    }

    if (request.method === "GET" && resource === "schedules") {
      return this.cached(`schedules:${id ?? "list"}`, () => schedules(this.client, id));
    }
    if (request.method === "PUT" && resource === "schedules" && id === "system-1") {
      const body = await jsonBody(request);
      return this.write(["schedules:list", "schedules:system-1"], async () => {
        await setSystemSchedule(this.client, {
          mode: optionalStringField(body, "mode"),
          numEvents: optionalStringField(body, "numEvents") ?? optionalStringField(body, "num_events"),
          wake: optionalStringField(body, "occ") ?? optionalStringField(body, "wake"),
          sleep: optionalStringField(body, "unocc") ?? optionalStringField(body, "sleep"),
        });
        return { ok: true };
      });
    }

    if (request.method === "GET" && resource === "water-temperatures") {
      return this.cached(`water-temperatures:${id ?? "list"}`, () => waterTemperatures(this.client, id));
    }

    if (request.method === "GET" && resource === "graphs") {
      return this.cached("graphs", () => graphs(this.client));
    }
    if (request.method === "GET" && resource === "graphs.csv") {
      const csv = await graphCsv(this.client, Object.fromEntries(new URL(request.url).searchParams));
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    throw new Error(`Route not found: ${request.method} ${path}`);
  }

  private cached(key: string, load: () => Promise<unknown>): Promise<unknown> {
    const existing = this.cache.get(key);
    const now = this.now();
    if (existing && existing.expiresAt > now) return existing.value;

    const value = load().catch((error) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, { value, expiresAt: now + this.cacheTtlMs });
    return value;
  }

  private write(invalidateKeys: string[], operation: () => Promise<unknown>): Promise<unknown> {
    const run = this.writeQueue.then(async () => {
      const result = await operation();
      invalidateKeys.forEach((key) => this.cache.delete(key));
      return result;
    });
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  private ensureAuthenticated(): Promise<void> {
    this.authentication ??= this.client.ensureAuthenticated();
    return this.authentication;
  }
}

export function createDaemon(options?: DaemonOptions): TekmarDaemon {
  return new TekmarDaemon(options);
}

function stripApiPrefix(path: string): string {
  return path.startsWith("/api/") ? path.slice(4) : path;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function jsonBody(request: Request): Promise<JsonBody> {
  const body = await request.json().catch(() => undefined);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON body is required.");
  return body as JsonBody;
}

function stringField(body: JsonBody, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !value) throw new Error(`${field} is required.`);
  return value;
}

function optionalStringField(body: JsonBody, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function numberField(body: JsonBody, field: string): number {
  const value = Number(body[field]);
  if (!Number.isFinite(value)) throw new Error(`${field} is required.`);
  return value;
}

function setpointKind(body: JsonBody): "heat" | "cool" {
  const value = body.kind;
  if (value === "heat" || value === "cool") return value;
  throw new Error("kind is required.");
}

function numberEnv(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
