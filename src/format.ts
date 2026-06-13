type AnyRecord = Record<string, unknown>;

export function formatDomain(resource: string, value: unknown): string {
  if (!isRecord(value)) return String(value);
  switch (resource) {
    case "temperatures":
      return "zones" in value ? formatTemperatureList(value) : formatTemperatureDetail(value);
    case "scenes":
      return "scenes" in value ? formatSceneList(value) : formatSceneDetail(value);
    case "schedules":
      return "schedules" in value ? formatScheduleList(value) : formatScheduleDetail(value);
    case "water":
    case "water-temperatures":
      return "systems" in value ? formatWaterList(value) : formatWaterDetail(value);
    case "graphs":
      return formatGraphs(value);
    default:
      return JSON.stringify(value, null, 2);
  }
}

export function formatSuccess(value: unknown): string {
  if (isRecord(value) && typeof value.out === "string") return `Wrote ${value.out}`;
  return "OK";
}

function formatTemperatureList(value: AnyRecord): string {
  const outdoor = formatTemp(value.outdoorTemperatureF);
  const zones = arrayOfRecords(value.zones);
  return [`Outdoor: ${outdoor}`, "", table(["ID", "Zone", "Temp", "Heat", "Cool"], zones.map((zone) => [
    text(zone.id),
    text(zone.name),
    formatTemp(zone.temperatureF),
    formatTemp(zone.heatSetpointF),
    formatTemp(zone.coolSetpointF),
  ]))].join("\n");
}

function formatTemperatureDetail(value: AnyRecord): string {
  const mode = isRecord(value.mode) ? value.mode : {};
  return [
    `${text(value.name)}${value.area ? ` (${text(value.area)})` : ""}`,
    `ID: ${text(value.id)}`,
    `Capabilities: ${arrayOfStrings(value.capabilities).join(", ") || "none"}`,
    `Mode: ${text(mode.current)}${arrayOfStrings(mode.available).length ? ` (available: ${arrayOfStrings(mode.available).join(", ")})` : ""}`,
  ].join("\n");
}

function formatSceneList(value: AnyRecord): string {
  const scenes = arrayOfRecords(value.scenes);
  const current = scenes.find((scene) => scene.current);
  return [`Current scene: ${text(current?.name ?? value.currentSceneId)}`, "", table(["ID", "Scene", "Current", "Detail"], scenes.map((scene) => [
    text(scene.id),
    text(scene.name),
    scene.current ? "*" : "",
    text(scene.detailPath),
  ]))].join("\n");
}

function formatSceneDetail(value: AnyRecord): string {
  const zones = arrayOfRecords(value.zones);
  return [`Scene ${text(value.id)}`, "", table(["Zone ID", "Zone"], zones.map((zone) => [text(zone.id), text(zone.name)]))].join("\n");
}

function formatScheduleList(value: AnyRecord): string {
  const schedules = arrayOfRecords(value.schedules);
  return [`${text(value.networkTime)}`, "", table(["ID", "Schedule", "Master", "Zones"], schedules.map((schedule) => [
    text(schedule.id),
    text(schedule.name),
    text(schedule.master),
    arrayOfStrings(schedule.memberZones).join(", "),
  ]))].join("\n");
}

function formatScheduleDetail(value: AnyRecord): string {
  const times = isRecord(value.times) ? value.times : {};
  return [
    `Schedule ${text(value.id)}`,
    `${text(value.networkTime)}`,
    `Mode: ${text(value.mode)}${arrayOfStrings(value.availableModes).length ? ` (${arrayOfStrings(value.availableModes).join(", ")})` : ""}`,
    `Events: ${text(value.eventCount)}${arrayOfStrings(value.availableEventCounts).length ? ` (${arrayOfStrings(value.availableEventCounts).join(", ")})` : ""}`,
    `Occ: ${text(times.occ)}`,
    `UnOcc: ${text(times.unocc)}`,
  ].join("\n");
}

function formatWaterList(value: AnyRecord): string {
  const systems = arrayOfRecords(value.systems);
  const resetActions = arrayOfRecords(value.resetActions);
  return [
    "Systems",
    table(["ID", "Name"], systems.map((system) => [text(system.id), text(system.name)])),
    "",
    "Reset actions",
    table(["Path", "ID", "Type"], resetActions.map((action) => [text(action.path), text(action.id), text(action.type)])),
  ].join("\n");
}

function formatWaterDetail(value: AnyRecord): string {
  const zones = arrayOfRecords(value.zones);
  return [`Water system ${text(value.id)}`, "", table(["Address", "Area", "Zone"], zones.map((zone) => [
    text(zone.address),
    text(zone.area),
    text(zone.name),
  ]))].join("\n");
}

function formatGraphs(value: AnyRecord): string {
  const series = arrayOfRecords(value.series);
  return table(["Series", "Points", "First", "Last"], series.map((entry) => [
    text(entry.name),
    text(entry.pointCount),
    formatPoint(entry.first),
    formatPoint(entry.last),
  ]));
}

function table(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  const widths = headers.map((_, index) => Math.max(...allRows.map((row) => row[index]?.length ?? 0)));
  const render = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  return [render(headers), divider, ...rows.map(render)].join("\n");
}

function formatTemp(value: unknown): string {
  return typeof value === "number" ? `${value} F` : "-";
}

function formatPoint(value: unknown): string {
  if (!Array.isArray(value) || value.length < 2) return "-";
  return `${text(value[0])}: ${text(value[1])}`;
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayOfRecords(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((entry) => entry !== "-") : [];
}
