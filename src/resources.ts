import { formBody, parseForms, parseLinks, parseTables, stripTags, type HtmlForm } from "./html";
import type { TekmarClient } from "./client";

export function requireYes(options: Record<string, string | boolean>): void {
  if (!options.yes) throw new Error("Refusing to run write command without --yes.");
}

export async function temperatures(client: TekmarClient, id?: string) {
  const path = id ? `/temperatures/${id}` : "/temperatures";
  const html = await client.get(path);
  return {
    path,
    headings: headings(html),
    links: parseLinks(html).filter((link) => link.href.includes("/temperatures/")),
    tables: parseTables(html),
    forms: summarizeForms(html),
  };
}

export async function setTemperatureMode(client: TekmarClient, id: string, mode: string) {
  const { form } = await client.formFor(`/temperatures/${id}`, (action) => action.endsWith(`/temperatures/${id}`));
  const body = formBody(form, { "device[mode_setting]": mode });
  return client.put(`/temperatures/${id}`, body);
}

export async function scenes(client: TekmarClient, id?: string) {
  const path = id ? `/scenes/${id}` : "/scenes";
  const html = await client.get(path);
  return {
    path,
    headings: headings(html),
    links: parseLinks(html),
    tables: parseTables(html),
    forms: summarizeForms(html),
  };
}

export async function setScene(client: TekmarClient, sceneId: string) {
  const { form } = await client.formFor("/scenes", (action) => action.includes("/scenes/set"));
  const body = formBody(form, { tn4_id: sceneId });
  return client.put("/scenes/set", body);
}

export async function schedules(client: TekmarClient, detail?: string) {
  const path = detail ? `/schedules/${detail}` : "/schedules";
  const html = await client.get(path);
  return {
    path,
    headings: headings(html),
    links: parseLinks(html),
    tables: parseTables(html),
    forms: summarizeForms(html),
  };
}

export async function setSystemSchedule(client: TekmarClient, options: { mode?: string; numEvents?: string; wake?: string; sleep?: string }) {
  const html = await client.get("/schedules/system-1");
  const body = formBodyFromForms(parseForms(html), {
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.numEvents ? { num_events: options.numEvents } : {}),
    ...(options.wake ? { "events[Wake][all_days]": options.wake } : {}),
    ...(options.sleep ? { "events[Sleep][all_days]": options.sleep } : {}),
  });
  return client.put("/schedules/system-1", body);
}

export async function waterTemperatures(client: TekmarClient, id?: string) {
  const path = id ? `/water_temperatures/${id}` : "/water_temperatures";
  const html = await client.get(path);
  return {
    path,
    headings: headings(html),
    links: parseLinks(html),
    tables: parseTables(html),
    forms: summarizeForms(html),
  };
}

export async function resetRuntime(client: TekmarClient, id: string, type: string) {
  const token = await client.csrfFor("/water_temperatures");
  return client.post(`/water_temperatures/reset_runtime?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`, new URLSearchParams({ authenticity_token: token }));
}

export async function resetEnergyRuntime(client: TekmarClient) {
  const token = await client.csrfFor("/water_temperatures");
  return client.post("/water_temperatures/reset_energy_runtime", new URLSearchParams({ authenticity_token: token }));
}

export async function graphs(client: TekmarClient) {
  const html = await client.get("/graphs");
  return {
    path: "/graphs",
    finalPath: currentCanonicalPath(html) ?? "/graphs/show",
    headings: headings(html),
    series: graphSeries(html),
    forms: summarizeForms(html),
  };
}

export async function graphCsv(client: TekmarClient, overrides: Record<string, string> = {}) {
  const { form } = await client.formFor("/graphs", (action) => action.includes("/graphs/show"));
  const body = formBody(form, { ...overrides, csv_x: "CSV Export" });
  return client.put("/graphs/show", body);
}

function headings(html: string): string[] {
  return [...html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map((match) => stripTags(match[1] ?? "")).filter(Boolean);
}

function summarizeForms(html: string) {
  return parseForms(html).map((form) => ({
    id: form.id,
    action: form.action,
    method: form.method,
    controls: form.controls
      .filter((control) => control.name || control.type === "submit")
      .map((control) => ({
        tag: control.tag,
        type: control.type,
        name: control.name,
        value: control.type === "hidden" && control.name === "authenticity_token" ? "[csrf]" : control.value,
        checked: control.checked,
        options: control.options?.map((option) => option.text),
      })),
  }));
}

function graphSeries(html: string) {
  const series: Array<{ name: string; points: Array<[number, number]> }> = [];
  for (const { name, raw } of extractArrayAssignments(html)) {
    try {
      const points = JSON.parse(raw.replace(/,\s*]/g, "]")) as Array<[number, number]>;
      if (isPointSeries(points)) series.push({ name, points });
    } catch {
      // Ignore non-data assignments.
    }
  }
  return series;
}

function isPointSeries(value: unknown): value is Array<[number, number]> {
  return Array.isArray(value) && value.some((point) => Array.isArray(point) && point.length === 2 && point.every((entry) => typeof entry === "number"));
}

function extractArrayAssignments(html: string): Array<{ name: string; raw: string }> {
  const assignments: Array<{ name: string; raw: string }> = [];
  const pattern = /\b(?:var\s+)?([A-Za-z][A-Za-z0-9_]*)\s*=\s*\[/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const name = match[1]!;
    let depth = 1;
    let cursor = pattern.lastIndex;
    while (cursor < html.length && depth > 0) {
      const char = html[cursor++];
      if (char === "[") depth += 1;
      if (char === "]") depth -= 1;
    }
    const raw = `[${html.slice(pattern.lastIndex, cursor)}`;
    if (depth === 0 && raw.includes("[")) assignments.push({ name, raw });
    pattern.lastIndex = cursor;
  }
  return assignments;
}

function formBodyFromForms(forms: HtmlForm[], overrides: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const form of forms) {
    for (const [key, value] of formBody(form, overrides)) {
      if (!body.has(key)) body.append(key, value);
    }
  }
  for (const [key, value] of Object.entries(overrides)) body.set(key, value);
  return body;
}

function currentCanonicalPath(html: string): string | undefined {
  const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1];
  if (!canonical) return undefined;
  try {
    return new URL(canonical).pathname;
  } catch {
    return canonical;
  }
}
