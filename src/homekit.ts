import { mkdir } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  Accessory,
  Bridge,
  Categories,
  Characteristic,
  CharacteristicEventTypes,
  HAPStorage,
  MDNSAdvertiser,
  Service,
  uuid,
  type CharacteristicValue,
} from "@homebridge/hap-nodejs";
import { TekmarClient, type TekmarClientOptions } from "./client.js";
import { setTemperatureMode, setTemperatureSetpoint, temperatures, type TemperatureZone } from "./resources.js";

export type HomeKitBridgeOptions = TekmarClientOptions & {
  name?: string;
  username?: string;
  pin?: string;
  setupId?: string;
  port?: number;
  bind?: string;
  storagePath?: string;
  pollIntervalSeconds?: number;
};

type TargetHeatingCoolingState = 0 | 1 | 2 | 3;
type CurrentHeatingCoolingState = 0 | 1 | 2;

type ZoneState = TemperatureZone & {
  lastTargetState: TargetHeatingCoolingState;
};

type TemperatureList = {
  outdoorTemperatureF: number | null;
  zones: TemperatureZone[];
};

type ZoneRuntime = {
  accessory: Accessory;
  service: Service;
};

const DEFAULT_NAME = "Tekmar";
const DEFAULT_USERNAME = "C2:71:54:4B:32:10";
const DEFAULT_PIN = "031-45-154";
const DEFAULT_SETUP_ID = "TKMR";
const DEFAULT_POLL_INTERVAL_SECONDS = 30;
const MANUFACTURER = "tekmar";
const MODEL = "tN4 Gateway";

export class TekmarHomeKitBridge {
  private readonly client: TekmarClient;
  private readonly name: string;
  private readonly username: string;
  private readonly pin: string;
  private readonly setupId: string;
  private readonly port?: number;
  private readonly bind?: string;
  private readonly pollIntervalMs: number;
  private readonly storagePath: string;
  private readonly states = new Map<string, ZoneState>();
  private readonly zones = new Map<string, ZoneRuntime>();
  private bridge: Bridge | undefined;
  private pollTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: HomeKitBridgeOptions = {}) {
    this.client = new TekmarClient(options);
    this.name = options.name ?? env("TEKMAR_HOMEKIT_NAME") ?? DEFAULT_NAME;
    this.username = options.username ?? env("TEKMAR_HOMEKIT_USERNAME") ?? DEFAULT_USERNAME;
    this.pin = options.pin ?? env("TEKMAR_HOMEKIT_PIN") ?? DEFAULT_PIN;
    this.setupId = options.setupId ?? env("TEKMAR_HOMEKIT_SETUP_ID") ?? DEFAULT_SETUP_ID;
    this.port = numberOption(options.port, "TEKMAR_HOMEKIT_PORT");
    this.bind = options.bind ?? env("TEKMAR_HOMEKIT_BIND") ?? defaultHomeKitBind();
    this.pollIntervalMs = Math.max(5, numberOption(options.pollIntervalSeconds, "TEKMAR_HOMEKIT_POLL_INTERVAL_SECONDS") ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000;
    this.storagePath = options.storagePath ?? env("TEKMAR_HOMEKIT_STORAGE") ?? join(homedir(), ".tekmar-homekit");
  }

  async start(): Promise<void> {
    await mkdir(this.storagePath, { recursive: true });
    HAPStorage.setCustomStoragePath(this.storagePath);

    await this.client.ensureAuthenticated();
    const snapshot = await temperatures(this.client) as TemperatureList;

    this.bridge = new Bridge(this.name, uuid.generate("tekmar-homekit:bridge"));
    this.bridge
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(Characteristic.Model, MODEL)
      .setCharacteristic(Characteristic.SerialNumber, "tekmar-homekit-bridge");

    for (const zone of snapshot.zones) {
      if (!zone.id) continue;
      this.addZone(zone);
    }

    await this.bridge.publish({
      username: this.username,
      pincode: this.pin,
      category: Categories.BRIDGE,
      setupID: this.setupId,
      port: this.port,
      bind: this.bind,
      advertiser: MDNSAdvertiser.CIAO,
      addIdentifyingMaterial: false,
    });

    this.pollTimer = setInterval(() => {
      this.refresh().catch((error) => console.warn(`Tekmar refresh failed: ${errorMessage(error)}`));
    }, this.pollIntervalMs);

    console.log(`${this.name} HomeKit bridge is running.`);
    console.log(`Pairing code: ${this.pin}`);
    if (this.bind) console.log(`HomeKit bind interface: ${this.bind}`);
    console.log(`Storage: ${this.storagePath}`);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    await this.bridge?.unpublish();
  }

  private addZone(zone: TemperatureZone): void {
    if (!this.bridge || !zone.id) return;
    const state = withTargetState(zone);
    this.states.set(zone.id, state);

    const accessory = new Accessory(zone.name, uuid.generate(`tekmar-homekit:zone:${zone.id}`));
    accessory.category = Categories.THERMOSTAT;
    accessory
      .getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(Characteristic.Model, MODEL)
      .setCharacteristic(Characteristic.SerialNumber, `tekmar-zone-${zone.id}`);

    const service = accessory.addService(Service.Thermostat, zone.name);
    service.setCharacteristic(Characteristic.Name, zone.name);

    service.getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({ minValue: -40, maxValue: 100, minStep: 0.5 })
      .on(CharacteristicEventTypes.GET, (callback) => callback(null, this.currentTemperature(zone.id!)));

    service.getCharacteristic(Characteristic.TargetTemperature)
      .setProps({ minValue: fahrenheitToCelsius(40), maxValue: fahrenheitToCelsius(85), minStep: fahrenheitToCelsiusStep(1) })
      .on(CharacteristicEventTypes.GET, (callback) => callback(null, this.targetTemperature(zone.id!)))
      .on(CharacteristicEventTypes.SET, (value, callback) => {
        this.setTargetTemperature(zone.id!, Number(value)).then(() => callback()).catch(callback);
      });

    service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .on(CharacteristicEventTypes.GET, (callback) => callback(null, this.currentHeatingCoolingState(zone.id!)));

    service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: targetStateValues(state) })
      .on(CharacteristicEventTypes.GET, (callback) => callback(null, this.targetHeatingCoolingState(zone.id!)))
      .on(CharacteristicEventTypes.SET, (value, callback) => {
        this.setTargetHeatingCoolingState(zone.id!, Number(value)).then(() => callback()).catch(callback);
      });

    service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .on(CharacteristicEventTypes.GET, (callback) => callback(null, Characteristic.TemperatureDisplayUnits.FAHRENHEIT));

    this.zones.set(zone.id, { accessory, service });
    this.updateThermostat(zone.id, zone);
    this.bridge.addBridgedAccessory(accessory);
  }

  private async refresh(): Promise<void> {
    const snapshot = await temperatures(this.client) as TemperatureList;
    for (const zone of snapshot.zones) {
      if (!zone.id) continue;
      const existing = this.states.get(zone.id);
      this.states.set(zone.id, { ...zone, lastTargetState: existing?.lastTargetState ?? preferredTargetState(zone) });
      this.updateThermostat(zone.id, zone);
    }
  }

  private updateThermostat(id: string, zone: TemperatureZone): void {
    const runtime = this.zones.get(id);
    const state = this.states.get(id);
    if (!runtime) return;
    runtime.service.updateCharacteristic(Characteristic.CurrentTemperature, fahrenheitToCelsius(zone.temperatureF ?? 0));
    runtime.service.updateCharacteristic(Characteristic.TargetTemperature, targetTemperatureC(zone));
    runtime.service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, currentState(zone));
    runtime.service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, state?.lastTargetState ?? preferredTargetState(zone));
  }

  private currentTemperature(id: string): CharacteristicValue {
    return fahrenheitToCelsius(this.stateFor(id).temperatureF ?? 0);
  }

  private targetTemperature(id: string): CharacteristicValue {
    return targetTemperatureC(this.stateFor(id));
  }

  private currentHeatingCoolingState(id: string): CharacteristicValue {
    return currentState(this.stateFor(id));
  }

  private targetHeatingCoolingState(id: string): CharacteristicValue {
    return this.stateFor(id).lastTargetState;
  }

  private async setTargetTemperature(id: string, temperatureC: number): Promise<void> {
    const state = this.stateFor(id);
    const kind = setpointKindFor(state);
    const temperatureF = celsiusToFahrenheit(temperatureC);
    this.states.set(id, { ...state, [`${kind}SetpointF`]: Math.round(temperatureF) });
    await setTemperatureSetpoint(this.client, id, kind, temperatureF);
    await this.refresh();
  }

  private async setTargetHeatingCoolingState(id: string, value: number): Promise<void> {
    if (!isTargetHeatingCoolingState(value)) throw new Error(`Unsupported target state: ${value}`);
    const state = this.stateFor(id);
    this.states.set(id, { ...state, lastTargetState: value });
    await setTemperatureMode(this.client, id, tekmarModeFor(value, state));
    await this.refresh();
  }

  private stateFor(id: string): ZoneState {
    const state = this.states.get(id);
    if (!state) throw new Error(`No Tekmar state for zone ${id}`);
    return state;
  }
}

function withTargetState(zone: TemperatureZone): ZoneState {
  return { ...zone, lastTargetState: preferredTargetState(zone) };
}

function preferredTargetState(zone: TemperatureZone): TargetHeatingCoolingState {
  if (zone.heatSetpointF !== null && zone.coolSetpointF !== null) return 3;
  if (zone.heatSetpointF !== null) return 1;
  if (zone.coolSetpointF !== null) return 2;
  return 0;
}

function currentState(zone: TemperatureZone): CurrentHeatingCoolingState {
  if (zone.temperatureF === null) return 0;
  if (zone.heatSetpointF !== null && zone.temperatureF < zone.heatSetpointF) return 1;
  if (zone.coolSetpointF !== null && zone.temperatureF > zone.coolSetpointF) return 2;
  return 0;
}

function targetTemperatureC(zone: TemperatureZone): number {
  return fahrenheitToCelsius(zone.heatSetpointF ?? zone.coolSetpointF ?? zone.temperatureF ?? 68);
}

function setpointKindFor(zone: ZoneState): "heat" | "cool" {
  if (zone.heatSetpointF !== null) return "heat";
  if (zone.coolSetpointF !== null) return "cool";
  return zone.lastTargetState === 2 ? "cool" : "heat";
}

function targetStateValues(zone: ZoneState): TargetHeatingCoolingState[] {
  const values = new Set<TargetHeatingCoolingState>([0]);
  if (zone.heatSetpointF !== null) values.add(1);
  if (zone.coolSetpointF !== null) values.add(2);
  if (zone.heatSetpointF !== null && zone.coolSetpointF !== null) values.add(3);
  return [...values];
}

function tekmarModeFor(state: TargetHeatingCoolingState, zone: ZoneState): string {
  if (state === 0) return "0";
  if (state === 1) return "1";
  if (state === 2) return "3";
  return zone.coolSetpointF !== null ? "3" : "1";
}

function isTargetHeatingCoolingState(value: number): value is TargetHeatingCoolingState {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function fahrenheitToCelsius(value: number): number {
  return (value - 32) * 5 / 9;
}

function fahrenheitToCelsiusStep(value: number): number {
  return value * 5 / 9;
}

function celsiusToFahrenheit(value: number): number {
  return value * 9 / 5 + 32;
}

function numberOption(value: number | undefined, envName: string): number | undefined {
  const parsed = value ?? Number(env(envName));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function defaultHomeKitBind(): string | undefined {
  const interfaces = networkInterfaces();
  const candidates = Object.entries(interfaces)
    .filter(([name]) => /^en\d+$/.test(name))
    .filter(([, addresses]) => addresses?.some((address) => address.family === "IPv4" && !address.internal));

  return candidates[0]?.[0];
}

function env(name: string): string | undefined {
  return process.env[name];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
