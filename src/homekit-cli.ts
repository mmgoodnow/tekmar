#!/usr/bin/env node
import { TekmarHomeKitBridge, type HomeKitBridgeOptions } from "./homekit.js";

type Parsed = {
  options: Record<string, string | boolean>;
};

const parsed = parseArgs(process.argv.slice(2));
const bridge = new TekmarHomeKitBridge(optionsFromArgs(parsed.options));

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

await bridge.start();

async function shutdown(): Promise<void> {
  await bridge.stop().catch(() => undefined);
  process.exit(0);
}

function parseArgs(args: string[]): Parsed {
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      options[rawKey] = inlineValue;
    } else if (args[i + 1] && !args[i + 1]!.startsWith("--")) {
      options[rawKey] = args[++i]!;
    } else {
      options[rawKey] = true;
    }
  }
  return { options };
}

function optionsFromArgs(options: Record<string, string | boolean>): HomeKitBridgeOptions {
  return {
    baseUrl: stringOption(options["base-url"]),
    login: stringOption(options.login),
    password: stringOption(options.password),
    sessionCookie: stringOption(options["session-cookie"]),
    name: stringOption(options.name),
    username: stringOption(options.username),
    pin: stringOption(options.pin),
    setupId: stringOption(options["setup-id"]),
    bind: stringOption(options.bind),
    port: numberOption(options.port),
    storagePath: stringOption(options.storage),
    pollIntervalSeconds: numberOption(options["poll-interval"]),
  };
}

function stringOption(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOption(value: string | boolean | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
