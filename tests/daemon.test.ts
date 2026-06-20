import assert from "node:assert/strict";
import { test } from "node:test";
import { TekmarDaemon } from "../src/daemon";

test("serves cached temperature reads", async () => {
  let calls = 0;
  const client = {
    async ensureAuthenticated() {},
    async get(path: string) {
      calls += 1;
      if (path === "/temperatures") return `<h4>Current outdoor temperature: 79 &deg;F</h4>`;
      throw new Error(`unexpected path ${path}`);
    },
  };
  const daemon = new TekmarDaemon({ client: client as never, cacheTtlMs: 1_000, now: () => 0 });

  const first = await daemon.handle(new Request("http://localhost/api/temperatures"));
  const second = await daemon.handle(new Request("http://localhost/api/temperatures"));

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(calls, 1);
});

test("serializes writes and invalidates changed temperature cache", async () => {
  const calls: string[] = [];
  let pendingFirstWrite: (() => void) | undefined;
  const client = {
    async ensureAuthenticated() {},
    async get(path: string) {
      calls.push(`get ${path}`);
      if (path === "/temperatures") return `<h4>Current outdoor temperature: 79 &deg;F</h4>`;
      throw new Error(`unexpected path ${path}`);
    },
    async formFor(path: string) {
      calls.push(`form ${path}`);
      return {
        form: {
          action: path,
          method: "post",
          controls: [
            { tag: "input", type: "hidden", name: "authenticity_token", value: "abc" },
            { tag: "input", type: "radio", name: "device[mode_setting]", value: "1", checked: true },
          ],
        },
      };
    },
    async put(path: string) {
      calls.push(`put ${path}`);
      if (!pendingFirstWrite) await new Promise<void>((resolve) => { pendingFirstWrite = resolve; });
      return "";
    },
  };
  const daemon = new TekmarDaemon({ client: client as never, cacheTtlMs: 1_000, now: () => 0 });

  await daemon.handle(new Request("http://localhost/api/temperatures"));
  const first = daemon.handle(new Request("http://localhost/api/temperatures/9/mode", { method: "PUT", body: JSON.stringify({ mode: "2" }) }));
  const second = daemon.handle(new Request("http://localhost/api/temperatures/9/mode", { method: "PUT", body: JSON.stringify({ mode: "3" }) }));

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["get /temperatures", "form /temperatures/9", "put /temperatures/9"]);
  pendingFirstWrite?.();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);

  await daemon.handle(new Request("http://localhost/api/temperatures"));
  assert.equal(calls.filter((call) => call === "get /temperatures").length, 2);
});
