import { expect, test } from "bun:test";
import { formatDomain, formatSuccess } from "../src/format";

test("formats temperature list as a table", () => {
  const output = formatDomain("temperatures", {
    outdoorTemperatureF: 79,
    zones: [{ id: "9", name: "Sunroom", temperatureF: 75, heatSetpointF: 64, coolSetpointF: null }],
  });

  expect(output).toContain("Outdoor: 79 F");
  expect(output).toContain("ID  Zone");
  expect(output).toContain("9   Sunroom  75 F  64 F  -");
});

test("formats schedule detail as labeled fields", () => {
  const output = formatDomain("schedules", {
    id: "system-1",
    networkTime: "Current Network Time: 01:29 AM",
    mode: "0",
    eventCount: 2,
    events: { wake: "48", sleep: "0" },
    availableModes: ["24hr", "5-2"],
    availableEventCounts: ["2", "4"],
  });

  expect(output).toContain("Schedule system-1");
  expect(output).toContain("Mode: 0 (24hr, 5-2)");
  expect(output).toContain("Wake: 48");
});

test("formats success output", () => {
  expect(formatSuccess({ ok: true })).toBe("OK");
  expect(formatSuccess({ ok: true, out: "graph.csv" })).toBe("Wrote graph.csv");
});

