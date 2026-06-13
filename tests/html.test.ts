import { expect, test } from "bun:test";
import { csrfToken, formBody, parseForms, parseLinks, parseTables } from "../src/html";
import { graphCsv, graphs } from "../src/resources";

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
  expect(result.headings).toEqual(["Current outdoor temperature: 79 °F"]);
  expect(result.series).toEqual([{ name: "OutdoorTemperature", points: [[0, 80.2]] }]);
});
