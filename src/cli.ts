#!/usr/bin/env bun
import { basename } from "node:path";
import { TekmarClient } from "./client";
import { formatDomain, formatSuccess } from "./format";
import {
  graphCsv,
  graphs,
  rawGraphs,
  rawScenes,
  rawSchedules,
  rawTemperatures,
  rawWaterTemperatures,
  requireYes,
  resetEnergyRuntime,
  resetRuntime,
  scenes,
  schedules,
  setScene,
  setSystemSchedule,
  setTemperatureMode,
  temperatures,
  waterTemperatures,
} from "./resources";

type Parsed = {
  positionals: string[];
  options: Record<string, string | boolean>;
};

async function main() {
  const parsed = parseArgs(Bun.argv.slice(2));
  const [resource, subcommand, maybeId] = parsed.positionals;
  if (!resource || resource === "help" || resource === "--help") return help(commandName(Bun.argv));

  const client = new TekmarClient();
  await client.ensureAuthenticated();

  switch (resource) {
    case "temperatures":
      if (subcommand === "set-mode") {
        requireYes(parsed.options);
        if (!maybeId || !parsed.positionals[3]) throw new Error("Usage: temperatures set-mode <id> <mode> --yes");
        await setTemperatureMode(client, maybeId, parsed.positionals[3]);
        return printSuccess({ ok: true }, parsed.options);
      }
      if (parsed.options.raw) return print(await rawTemperatures(client, subcommand));
      return printDomain("temperatures", await temperatures(client, subcommand), parsed.options);

    case "scenes":
      if (subcommand === "set") {
        requireYes(parsed.options);
        if (!maybeId) throw new Error("Usage: scenes set <scene-id> --yes");
        await setScene(client, maybeId);
        return printSuccess({ ok: true }, parsed.options);
      }
      if (parsed.options.raw) return print(await rawScenes(client, subcommand));
      return printDomain("scenes", await scenes(client, subcommand), parsed.options);

    case "schedules":
      if (subcommand === "system-1" && maybeId === "set") {
        requireYes(parsed.options);
        await setSystemSchedule(client, {
          mode: stringOption(parsed.options.mode),
          numEvents: stringOption(parsed.options["num-events"]),
          wake: stringOption(parsed.options.occ) ?? stringOption(parsed.options.wake),
          sleep: stringOption(parsed.options.unocc) ?? stringOption(parsed.options.sleep),
        });
        return printSuccess({ ok: true }, parsed.options);
      }
      if (parsed.options.raw) return print(await rawSchedules(client, subcommand));
      return printDomain("schedules", await schedules(client, subcommand), parsed.options);

    case "water":
    case "water-temperatures":
      if (subcommand === "reset-runtime") {
        requireYes(parsed.options);
        const id = stringOption(parsed.options.id);
        const type = stringOption(parsed.options.type);
        if (!id || !type) throw new Error("Usage: water reset-runtime --id <id> --type <boiler|pump> --yes");
        await resetRuntime(client, id, type);
        return printSuccess({ ok: true }, parsed.options);
      }
      if (subcommand === "reset-energy-runtime") {
        requireYes(parsed.options);
        await resetEnergyRuntime(client);
        return printSuccess({ ok: true }, parsed.options);
      }
      if (parsed.options.raw) return print(await rawWaterTemperatures(client, subcommand));
      return printDomain(resource, await waterTemperatures(client, subcommand), parsed.options);

    case "graphs":
      if (subcommand === "csv") {
        const csv = await graphCsv(client);
        const out = stringOption(parsed.options.out);
        if (out) {
          await Bun.write(out, csv);
          return printSuccess({ ok: true, out }, parsed.options);
        }
        process.stdout.write(csv);
        return;
      }
      if (parsed.options.raw) return print(await rawGraphs(client));
      return printDomain("graphs", await graphs(client), parsed.options);

    default:
      throw new Error(`Unknown resource: ${resource}`);
  }
}

function parseArgs(args: string[]): Parsed {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      options[rawKey] = inlineValue;
    } else if (args[i + 1] && !args[i + 1]!.startsWith("--")) {
      options[rawKey] = args[++i]!;
    } else {
      options[rawKey] = true;
    }
  }
  return { positionals, options };
}

function stringOption(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printDomain(resource: string, value: unknown, options: Record<string, string | boolean>): void {
  if (options.json) return print(value);
  console.log(formatDomain(resource, value));
}

function printSuccess(value: unknown, options: Record<string, string | boolean>): void {
  if (options.json) return print(value);
  console.log(formatSuccess(value));
}

function commandName(argv: string[]): string {
  return basename(argv[1] ?? argv[0] ?? "tekmar");
}

function help(command: string): void {
  console.log(`Usage:
  ${command} temperatures [id]
  ${command} temperatures set-mode <id> <mode> --yes
  ${command} scenes [id]
  ${command} scenes set <scene-id> --yes
  ${command} schedules [system-1]
  ${command} schedules system-1 set [--mode n] [--num-events n] [--occ n] [--unocc n] --yes
  ${command} water [id]
  ${command} water reset-runtime --id <id> --type <type> --yes
  ${command} water reset-energy-runtime --yes
  ${command} graphs
  ${command} graphs csv [--out file.csv]

Options:
  --json  Print domain JSON instead of readable text
  --raw   Print parsed HTML/forms/tables for debugging`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
