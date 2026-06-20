import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDomain, formatSuccess } from "../src/format";

test("formats temperature list as a table", () => {
  const output = formatDomain("temperatures", {
    outdoorTemperatureF: 79,
    zones: [{ id: "9", name: "Sunroom", temperatureF: 75, heatSetpointF: 64, coolSetpointF: null }],
  });

  assert.match(output, /Outdoor: 79 F/);
  assert.match(output, /ID  Zone/);
  assert.match(output, /9   Sunroom  75 F  64 F  -/);
});

test("formats schedule detail as labeled fields", () => {
  const output = formatDomain("schedules", {
    id: "system-1",
    networkTime: "Current Network Time: 01:29 AM",
    mode: "0",
    eventCount: 2,
    times: { occ: "48", unocc: "0" },
    availableModes: ["24hr", "5-2"],
    availableEventCounts: ["2", "4"],
  });

  assert.match(output, /Schedule system-1/);
  assert.match(output, /Mode: 0 \(24hr, 5-2\)/);
  assert.match(output, /Occ: 48/);
});

test("formats success output", () => {
  assert.equal(formatSuccess({ ok: true }), "OK");
  assert.equal(formatSuccess({ ok: true, out: "graph.csv" }), "Wrote graph.csv");
});
