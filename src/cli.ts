#!/usr/bin/env bun
import { TekmarClient } from "./client";
import {
  graphCsv,
  graphs,
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
  if (!resource || resource === "help" || resource === "--help") return help();

  const client = new TekmarClient();
  await client.ensureAuthenticated();

  switch (resource) {
    case "temperatures":
      if (subcommand === "set-mode") {
        requireYes(parsed.options);
        if (!maybeId || !parsed.positionals[3]) throw new Error("Usage: temperatures set-mode <id> <mode> --yes");
        await setTemperatureMode(client, maybeId, parsed.positionals[3]);
        return print({ ok: true });
      }
      return print(await temperatures(client, subcommand));

    case "scenes":
      if (subcommand === "set") {
        requireYes(parsed.options);
        if (!maybeId) throw new Error("Usage: scenes set <scene-id> --yes");
        await setScene(client, maybeId);
        return print({ ok: true });
      }
      return print(await scenes(client, subcommand));

    case "schedules":
      if (subcommand === "system-1" && maybeId === "set") {
        requireYes(parsed.options);
        await setSystemSchedule(client, {
          mode: stringOption(parsed.options.mode),
          numEvents: stringOption(parsed.options["num-events"]),
          wake: stringOption(parsed.options.wake),
          sleep: stringOption(parsed.options.sleep),
        });
        return print({ ok: true });
      }
      return print(await schedules(client, subcommand));

    case "water":
    case "water-temperatures":
      if (subcommand === "reset-runtime") {
        requireYes(parsed.options);
        const id = stringOption(parsed.options.id);
        const type = stringOption(parsed.options.type);
        if (!id || !type) throw new Error("Usage: water reset-runtime --id <id> --type <boiler|pump> --yes");
        await resetRuntime(client, id, type);
        return print({ ok: true });
      }
      if (subcommand === "reset-energy-runtime") {
        requireYes(parsed.options);
        await resetEnergyRuntime(client);
        return print({ ok: true });
      }
      return print(await waterTemperatures(client, subcommand));

    case "graphs":
      if (subcommand === "csv") {
        const csv = await graphCsv(client);
        const out = stringOption(parsed.options.out);
        if (out) {
          await Bun.write(out, csv);
          return print({ ok: true, out });
        }
        process.stdout.write(csv);
        return;
      }
      return print(await graphs(client));

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

function help(): void {
  console.log(`Usage:
  bun run cli temperatures [id]
  bun run cli temperatures set-mode <id> <mode> --yes
  bun run cli scenes [id]
  bun run cli scenes set <scene-id> --yes
  bun run cli schedules [system-1]
  bun run cli schedules system-1 set [--mode n] [--num-events n] [--wake n] [--sleep n] --yes
  bun run cli water [id]
  bun run cli water reset-runtime --id <id> --type <type> --yes
  bun run cli water reset-energy-runtime --yes
  bun run cli graphs
  bun run cli graphs csv [--out file.csv]`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

