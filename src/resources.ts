import { formBody, parseForms, parseLinks, parseTables, stripTags } from "./html.js";
import type { TekmarClient } from "./client.js";

export type TemperatureZone = {
  id?: string;
  name: string;
  temperatureF: number | null;
  heatSetpointF: number | null;
  coolSetpointF: number | null;
};

type RawTemperaturePage = {
  headings: string[];
  links: Array<{ href: string; text: string }>;
  tables: string[][][];
  thermostatRows: Array<{ id: string; cells: string[] }>;
  forms: ReturnType<typeof summarizeForms>;
};

export async function temperatures(client: TekmarClient, id?: string) {
  const raw = await rawTemperatures(client, id);
  if (id) return temperatureDetail(id, raw);
  return temperatureList(raw);
}

export async function setTemperatureMode(client: TekmarClient, id: string, mode: string) {
  const { form } = await client.formFor(`/temperatures/${id}`, (action) => action.endsWith(`/temperatures/${id}`));
  const body = formBody(form, { "device[mode_setting]": mode });
  return client.put(`/temperatures/${id}`, body);
}

export async function setTemperatureSetpoint(client: TekmarClient, id: string, kind: "heat" | "cool", temperatureF: number) {
  const { form } = await client.formFor(`/temperatures/${id}`, (action) => action.endsWith(`/temperatures/${id}`));
  const field = kind === "heat" ? "device[heating_setpoint]" : "device[cooling_setpoint]";
  const body = formBody(form, { [field]: String(Math.round(temperatureF)) });
  return client.put(`/temperatures/${id}`, body);
}

async function rawTemperatures(client: TekmarClient, id?: string): Promise<RawTemperaturePage> {
  const html = await client.get(id ? `/temperatures/${id}` : "/temperatures");
  return {
    headings: headings(html),
    links: parseLinks(html).filter((link) => link.href.includes("/temperatures/")),
    tables: parseTables(html),
    thermostatRows: id ? [] : await collectTemperatureAjaxRows(client, html),
    forms: summarizeForms(html),
  };
}

function temperatureList(raw: RawTemperaturePage) {
  const idByName = idsByLinkedName(raw.links, /\/temperatures\/(\d+)/);
  const rows: Array<{ id?: string; cells: string[] }> = raw.thermostatRows.length
    ? raw.thermostatRows
    : raw.tables.flatMap((table) => table.slice(1).map((row) => ({ cells: row })));
  const zones = rows
    .map((row) => temperatureZoneFromRow({ id: row.id ?? idByName.get(row.cells[0]), cells: row.cells }))
    .filter((zone) => zone !== undefined);
  return {
    outdoorTemperatureF: numberOrNull(raw.headings.join(" ").match(/(-?\d+(?:\.\d+)?)\s*°F/)?.[1]),
    zones,
  };
}

function temperatureDetail(id: string, raw: RawTemperaturePage) {
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
