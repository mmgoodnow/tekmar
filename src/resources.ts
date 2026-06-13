import { formBody, parseForms, parseLinks, parseTables, stripTags, type HtmlForm } from "./html";
import type { TekmarClient } from "./client";

export type TemperatureZone = {
  id?: string;
  name: string;
  temperatureF: number | null;
  heatSetpointF: number | null;
  coolSetpointF: number | null;
};

export type TemperatureStreamEvent =
  | { type: "outdoor"; outdoorTemperatureF: number | null }
  | { type: "zone"; zone: TemperatureZone };

export function requireYes(options: Record<string, string | boolean>): void {
  if (!options.yes) throw new Error("Refusing to run write command without --yes.");
}

export async function temperatures(client: TekmarClient, id?: string) {
  const raw = await rawTemperatures(client, id);
  if (id) return temperatureDetail(id, raw);
  return temperatureList(raw);
}

export async function rawTemperatures(client: TekmarClient, id?: string) {
  const path = id ? `/temperatures/${id}` : "/temperatures";
  const html = await client.get(path);
  const thermostatRows = id ? [] : await collectTemperatureAjaxRows(client, html);
  return {
    path,
    headings: headings(html),
    links: parseLinks(html).filter((link) => link.href.includes("/temperatures/")),
    tables: parseTables(html),
    thermostatRows,
    forms: summarizeForms(html),
  };
}

export async function* streamTemperatures(client: TekmarClient): AsyncGenerator<TemperatureStreamEvent> {
  const html = await client.get("/temperatures");
  yield { type: "outdoor", outdoorTemperatureF: outdoorTemperature(html) };
  for (const id of thermostatIds(html)) {
    const row = await temperatureAjaxRow(client, id);
    const zone = temperatureZoneFromRow(row);
    if (zone) yield { type: "zone", zone };
  }
}

export async function setTemperatureMode(client: TekmarClient, id: string, mode: string) {
  const { form } = await client.formFor(`/temperatures/${id}`, (action) => action.endsWith(`/temperatures/${id}`));
  const body = formBody(form, { "device[mode_setting]": mode });
  return client.put(`/temperatures/${id}`, body);
}

export async function scenes(client: TekmarClient, id?: string) {
  const raw = await rawScenes(client, id);
  if (id) return sceneDetail(id, raw);
  return sceneList(raw);
}

export async function rawScenes(client: TekmarClient, id?: string) {
  const path = id ? `/scenes/${id}` : "/scenes";
  const html = await client.get(path);
  return {
    path,
    headings: headings(html),
    links: parseLinks(html),
    tables: parseTables(html),
    sceneLabels: id ? {} : sceneLabels(html),
    forms: summarizeForms(html),
  };
}

export async function setScene(client: TekmarClient, sceneId: string) {
  const { form } = await client.formFor("/scenes", (action) => action.includes("/scenes/set"));
  const body = formBody(form, { tn4_id: sceneId });
  return client.put("/scenes/set", body);
}

export async function schedules(client: TekmarClient, detail?: string) {
  const raw = await rawSchedules(client, detail);
  if (detail) return scheduleDetail(detail, raw);
  return scheduleList(raw);
}

export async function rawSchedules(client: TekmarClient, detail?: string) {
  const path = detail ? `/schedules/${detail}` : "/schedules";
  const html = await client.get(path);
  return {
    path,
    headings: headings(html),
    links: parseLinks(html),
    tables: parseTables(html),
    scheduleRows: detail ? [] : scheduleRows(html),
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
  const raw = await rawWaterTemperatures(client, id);
  if (id) return waterTemperatureDetail(id, raw);
  return waterTemperatureList(raw);
}

export async function rawWaterTemperatures(client: TekmarClient, id?: string) {
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
  const raw = await rawGraphs(client);
  return {
    series: raw.series.map((series) => ({
      name: series.name,
      pointCount: series.points.length,
      first: series.points[0],
      last: series.points.at(-1),
    })),
  };
}

export async function rawGraphs(client: TekmarClient) {
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
        options: control.options?.map((option) => ({ value: option.value, text: option.text })),
      })),
  }));
}

type RawPage = {
  path: string;
  headings: string[];
  links: Array<{ href: string; text: string }>;
  tables: string[][][];
  thermostatRows?: Array<{ id: string; cells: string[] }>;
  sceneLabels?: Record<string, string>;
  scheduleRows?: Array<{ id: string; name: string; master: string; memberZones: string[] }>;
  forms: ReturnType<typeof summarizeForms>;
};

function temperatureList(raw: RawPage) {
  const idByName = idsByLinkedName(raw.links, /\/temperatures\/(\d+)/);
  const rows: Array<{ id?: string; cells: string[] }> = raw.thermostatRows?.length ? raw.thermostatRows : raw.tables.flatMap((table) => table.slice(1).map((row) => ({ cells: row })));
  const zones = rows
    .map((row) => temperatureZoneFromRow({ id: row.id ?? idByName.get(row.cells[0]), cells: row.cells }))
    .filter((zone) => zone !== undefined);
  return {
    outdoorTemperatureF: numberOrNull(raw.headings.join(" ").match(/(-?\d+(?:\.\d+)?)\s*°F/)?.[1]),
    zones,
  };
}

async function collectTemperatureAjaxRows(client: TekmarClient, html: string): Promise<Array<{ id: string; cells: string[] }>> {
  const rows = await Promise.all(thermostatIds(html).map((id) => temperatureAjaxRow(client, id)));
  return rows.filter((row) => row.cells.length > 0);
}

async function temperatureAjaxRow(client: TekmarClient, id: string): Promise<{ id: string; cells: string[] }> {
  const js = await client.get(`/temperatures/area_thermostat?thermostat_id=${id}`);
  const fragment = ajaxHtmlFragment(js);
  const cells = parseTables(`<table><tr>${fragment}</tr></table>`)[0]?.[0] ?? [];
  return { id, cells };
}

function thermostatIds(html: string): string[] {
  return [...new Set([...html.matchAll(/\bid=["']thermostat(\d+)["']/gi)].map((match) => match[1]!).filter(Boolean))];
}

function outdoorTemperature(html: string): number | null {
  return numberOrNull(headings(html).join(" ").match(/(-?\d+(?:\.\d+)?)\s*°F/)?.[1]);
}

function temperatureZoneFromRow(row: { id?: string; cells: string[] }): TemperatureZone | undefined {
  if (row.cells.length < 4 || !row.cells[0]) return undefined;
  return {
    id: row.id,
    name: row.cells[0],
    temperatureF: numberOrNull(row.cells[1]),
    heatSetpointF: numberOrNull(row.cells[2]),
    coolSetpointF: numberOrNull(row.cells[3]),
  };
}

function ajaxHtmlFragment(js: string): string {
  const raw = js.match(/myhtml="([\s\S]*?)"\s*\n?\s*\$\('thermostat\d+'\)\.replace\(myhtml\);?/)?.[1];
  if (!raw) return "";
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\\//g, "/").replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }
}

function temperatureDetail(id: string, raw: RawPage) {
  const title = raw.headings[0] ?? "";
  const [area, name] = title.includes(":") ? title.split(":", 2).map((part) => part.trim()) : [undefined, title];
  const modeControls = raw.forms.flatMap((form) => form.controls).filter((control) => control.name === "device[mode_setting]");
  return {
    id,
    name,
    area,
    capabilities: raw.headings.slice(1).map((heading) => heading.replace(/:$/, "")),
    mode: {
      current: modeControls.find((control) => control.checked)?.value,
      available: modeControls.map((control) => control.value).filter(Boolean),
    },
  };
}

function sceneList(raw: RawPage) {
  const details = raw.links.filter((link) => /\/scenes\/\d+/.test(link.href));
  const controls = raw.forms.flatMap((form) => form.controls).filter((control) => control.name === "tn4_id");
  return {
    currentSceneId: controls.find((control) => control.checked)?.value,
    scenes: controls.map((control, index) => ({
      id: control.value,
      name: raw.sceneLabels?.[control.value ?? ""],
      current: Boolean(control.checked),
      detailPath: pathOnly(details[index]?.href),
    })),
  };
}

function sceneLabels(html: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const match of html.matchAll(/<label\b[^>]*for=["']tn4_id_(\d+)["'][^>]*>([\s\S]*?)<\/label>/gi)) {
    labels[match[1]!] = stripTags(match[2] ?? "");
  }
  return labels;
}

function sceneDetail(id: string, raw: RawPage) {
  return {
    id,
    zones: raw.links
      .map((link) => ({ id: link.href.match(/\/temperatures\/(\d+)/)?.[1], name: link.text }))
      .filter((zone) => zone.id),
  };
}

function scheduleList(raw: RawPage) {
  return {
    networkTime: raw.headings.find((heading) => heading.includes("Network Time")),
    schedules: raw.scheduleRows?.length
      ? raw.scheduleRows
      : raw.links
        .map((link) => ({ id: link.href.match(/\/schedules\/([^/?#]+)/)?.[1], name: link.text, master: "", memberZones: [] }))
        .filter((schedule) => schedule.id),
  };
}

function scheduleDetail(id: string, raw: RawPage) {
  const controls = raw.forms.flatMap((form) => form.controls);
  return {
    id,
    networkTime: raw.headings.find((heading) => heading.includes("Network Time")),
    mode: selectText(controls, "mode"),
    eventCount: numberOrNull(selectValue(controls, "num_events")),
    times: {
      occ: selectText(controls, "events[Wake][all_days]"),
      unocc: selectText(controls, "events[Sleep][all_days]"),
    },
    availableModes: selectOptions(controls, "mode"),
    availableEventCounts: selectOptions(controls, "num_events"),
  };
}

function scheduleRows(html: string): Array<{ id: string; name: string; master: string; memberZones: string[] }> {
  return [...html.matchAll(/<div\b[^>]*class=["'][^"']*scheduleFields[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi)]
    .map((match) => {
      const block = match[1] ?? "";
      const link = parseLinks(block).find((candidate) => candidate.href.includes("/schedules/"));
      const fields = [...block.matchAll(/<div\b[^>]*class=["'][^"']*scheduleField["'][^>]*>([\s\S]*?)<\/div>/gi)].map((field) => stripTags(field[1] ?? ""));
      return {
        id: link?.href.match(/\/schedules\/([^/?#]+)/)?.[1] ?? "",
        name: link?.text ?? fields[0] ?? "",
        master: fields[1] ?? "",
        memberZones: [...block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((zone) => stripTags(zone[1] ?? "")).filter(Boolean),
      };
    })
    .filter((row) => row.id);
}

function waterTemperatureList(raw: RawPage) {
  return {
    systems: raw.links
      .map((link) => ({ id: link.href.match(/\/water_temperatures\/(\d+)/)?.[1], name: link.text }))
      .filter((system) => system.id),
    resetActions: raw.forms.map((form) => ({
      path: form.action.split("?")[0],
      id: new URLSearchParams(form.action.split("?")[1] ?? "").get("id"),
      type: new URLSearchParams(form.action.split("?")[1] ?? "").get("type"),
    })),
  };
}

function waterTemperatureDetail(id: string, raw: RawPage) {
  return {
    id,
    zones: raw.tables.flatMap((table) =>
      table.slice(1).map((row) => ({
        name: row[0],
        address: row[1],
        area: row[2],
      })),
    ).filter((zone) => zone.name),
  };
}

function idsByLinkedName(links: Array<{ href: string; text: string }>, pattern: RegExp): Map<string, string> {
  const ids = new Map<string, string>();
  for (const link of links) {
    const id = link.href.match(pattern)?.[1];
    if (id) ids.set(link.text, id);
  }
  return ids;
}

function numberOrNull(value: string | undefined): number | null {
  if (!value || value.toLowerCase() === "n/a") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function selectValue(controls: Array<{ name?: string; value?: string }>, name: string): string | undefined {
  return controls.find((control) => control.name === name)?.value;
}

function selectText(controls: Array<{ name?: string; value?: string; options?: Array<{ value: string; text: string }> }>, name: string): string | undefined {
  const control = controls.find((candidate) => candidate.name === name);
  return control?.options?.find((option) => option.value === control.value)?.text ?? control?.value;
}

function selectOptions(controls: Array<{ name?: string; options?: Array<{ value: string; text: string }> }>, name: string): string[] {
  return controls.find((control) => control.name === name)?.options?.map((option) => option.text) ?? [];
}

function pathOnly(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href).pathname;
  } catch {
    return href;
  }
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
