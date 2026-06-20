import { expect, test } from "bun:test";
import { csrfToken, formBody, parseForms, parseLinks, parseTables } from "../src/html";
import { graphCsv, graphs, setTemperatureSetpoint, streamTemperatures, temperatures } from "../src/resources";

test("parses Rails forms and builds override body", () => {
  const html = `<form action="/temperatures/9" method="post">
    <input name="utf8" value="&#x2713;">
    <input name="_method" value="put">
    <input name="authenticity_token" value="abc">
    <input type="radio" name="device[mode_setting]" value="1" checked>
    <input type="radio" name="device[mode_setting]" value="2">
  </form>`;

  const [form] = parseForms(html);
  expect(csrfToken(html)).toBe("abc");
  expect(form?.action).toBe("/temperatures/9");
  expect(formBody(form!, { "device[mode_setting]": "2" }).get("device[mode_setting]")).toBe("2");
});

test("parses links and tables", () => {
  const html = `<a href="/temperatures/9">Sunroom</a><table><tr><th>Name</th><td>Temp</td></tr></table>`;
  expect(parseLinks(html)).toEqual([{ href: "/temperatures/9", text: "Sunroom" }]);
  expect(parseTables(html)).toEqual([[["Name", "Temp"]]]);
});

test("graph csv posts csv_x to graph form", async () => {
  const calls: Array<{ path: string; body?: URLSearchParams }> = [];
  const client = {
    async formFor(path: string) {
      calls.push({ path });
      return {
        form: parseForms(`<form action="/graphs/show" method="post">
          <input name="authenticity_token" value="abc">
          <input name="_method" value="put">
          <input name="display_outdoor" value="1" checked type="checkbox">
        </form>`)[0]!,
      };
    },
    async put(path: string, body: URLSearchParams) {
      calls.push({ path, body });
      return "csv";
    },
  };

  const csv = await graphCsv(client as never);
  expect(csv).toBe("csv");
  expect(calls[1]?.path).toBe("/graphs/show");
  expect(calls[1]?.body?.get("csv_x")).toBe("CSV Export");
});

test("temperature setpoint posts the selected heating or cooling field", async () => {
  const calls: Array<{ path: string; body?: URLSearchParams }> = [];
  const client = {
    async formFor(path: string) {
      calls.push({ path });
      return {
        form: parseForms(`<form action="/temperatures/9" method="post">
          <input name="authenticity_token" value="abc">
          <input name="_method" value="put">
          <input type="radio" name="device[mode_setting]" value="1" checked>
        </form>`)[0]!,
      };
    },
    async put(path: string, body: URLSearchParams) {
      calls.push({ path, body });
      return "";
    },
  };

  await setTemperatureSetpoint(client as never, "9", "heat", 67);
  expect(calls[1]?.path).toBe("/temperatures/9");
  expect(calls[1]?.body?.get("device[heating_setpoint]")).toBe("67");
});


test("parses legacy entities and inline graph series", async () => {
  const client = {
    async get() {
      return `<h4>Current outdoor temperature: 79 &deg;F</h4>
      <script>
        var OutdoorTemperature=[[
          0, 80.2],
        ];
      </script>
      <form action="/graphs/show" method="post"></form>`;
    },
  };
  const result = await graphs(client as never);
  expect(result.series).toEqual([{ name: "OutdoorTemperature", pointCount: 1, first: [0, 80.2], last: [0, 80.2] }]);
});

test("returns a domain temperature list", async () => {
  const client = {
    async get() {
      return `<h4>Current outdoor temperature: 79 &deg;F</h4>
      <a href="/temperatures/9">Sunroom</a>
      <table>
        <tr><th>Name</th><th>Temperature<br>(°F)</th><th>Heat<br>(°F)</th><th>Cool<br>(°F)</th></tr>
        <tr><td>Sunroom</td><td>75</td><td>64</td><td>n/a</td></tr>
      </table>`;
    },
  };
  expect(await temperatures(client as never)).toEqual({
    outdoorTemperatureF: 79,
    zones: [{ id: "9", name: "Sunroom", temperatureF: 75, heatSetpointF: 64, coolSetpointF: null }],
  });
});

test("returns a domain temperature detail", async () => {
  const client = {
    async get() {
      return `<h2>First Floor: Sunroom</h2><h3>Mode</h3><h3>Heat:</h3>
      <form action="/temperatures/9" method="post">
        <input type="radio" name="device[mode_setting]" value="1" checked>
        <input type="radio" name="device[mode_setting]" value="2">
      </form>`;
    },
  };
  expect(await temperatures(client as never, "9")).toEqual({
    id: "9",
    name: "Sunroom",
    area: "First Floor",
    capabilities: ["Mode", "Heat"],
    mode: { current: "1", available: ["1", "2"] },
  });
});

test("returns Ajax-loaded temperature rows", async () => {
  const client = {
    async get(path: string) {
      if (path === "/temperatures") {
        return `<h4>Current outdoor temperature: 79 &deg;F</h4>
        <table><tr><th>Name</th><th>Temperature</th><th>Heat</th><th>Cool</th></tr>
          <tr id="thermostat9"></tr>
        </table>`;
      }
      return `myhtml="
        <td><a href=\\"/temperatures/9\\">Sunroom<\\/a><\\/td>
        <td>75<\\/td>
        <td><span>64<\\/span><\\/td>
        <td>n/a<\\/td>
      "
      $('thermostat9').replace(myhtml);`;
    },
  };

  expect(await temperatures(client as never)).toEqual({
    outdoorTemperatureF: 79,
    zones: [{ id: "9", name: "Sunroom", temperatureF: 75, heatSetpointF: 64, coolSetpointF: null }],
  });
});

test("streams Ajax-loaded temperature rows", async () => {
  const client = {
    async get(path: string) {
      if (path === "/temperatures") {
        return `<h4>Current outdoor temperature: 79 &deg;F</h4><tr id="thermostat9"></tr>`;
      }
      return `myhtml="<td><a href=\\"/temperatures/9\\">Sunroom<\\/a><\\/td><td>75<\\/td><td>64<\\/td><td>n/a<\\/td>"
      $('thermostat9').replace(myhtml);`;
    },
  };

  const events = [];
  for await (const event of streamTemperatures(client as never)) events.push(event);
  expect(events).toEqual([
    { type: "outdoor", outdoorTemperatureF: 79 },
    { type: "zone", zone: { id: "9", name: "Sunroom", temperatureF: 75, heatSetpointF: 64, coolSetpointF: null } },
  ]);
});
