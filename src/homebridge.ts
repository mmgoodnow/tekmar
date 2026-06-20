import type {
  API,
  CharacteristicValue,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from "homebridge";
import { APIEvent } from "homebridge";
import { TekmarClient } from "./client.js";
import { setTemperatureMode, setTemperatureSetpoint, temperatures, type TemperatureZone } from "./resources.js";

const PLUGIN_NAME = "homebridge-tekmar-gateway";
const PLATFORM_NAME = "TekmarGateway";
const MANUFACTURER = "tekmar";
const MODEL = "tN4 Gateway";
const DEFAULT_POLL_INTERVAL_SECONDS = 30;

type TekmarPlatformConfig = PlatformConfig & {
  baseUrl?: string;
  login?: string;
  password?: string;
  sessionCookie?: string;
  pollIntervalSeconds?: number;
  zones?: Record<string, { name?: string; hidden?: boolean }>;
};

type ZoneContext = {
  id: string;
  name: string;
};

type ZoneState = TemperatureZone & {
  lastTargetState: TargetHeatingCoolingState;
};

type TemperatureList = {
  outdoorTemperatureF: number | null;
  zones: TemperatureZone[];
};

type TargetHeatingCoolingState = 0 | 1 | 2 | 3;
type CurrentHeatingCoolingState = 0 | 1 | 2;

export default function register(api: API): void {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, TekmarPlatform);
}

class TekmarPlatform implements DynamicPlatformPlugin {
  private readonly client: TekmarClient;
  private readonly accessories = new Map<string, PlatformAccessory<ZoneContext>>();
  private readonly states = new Map<string, ZoneState>();
  private pollTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly log: Logging,
    private readonly config: TekmarPlatformConfig,
    private readonly api: API,
  ) {
    this.client = new TekmarClient({
      baseUrl: config.baseUrl,
      login: config.login,
      password: config.password,
      sessionCookie: config.sessionCookie,
    });

    this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      this.discover().catch((error) => this.log.error("Failed to discover Tekmar zones: %s", errorMessage(error)));
      this.startPolling();
    });
    this.api.on(APIEvent.SHUTDOWN, () => {
      if (this.pollTimer) clearInterval(this.pollTimer);
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    const typedAccessory = accessory as PlatformAccessory<ZoneContext>;
    this.accessories.set(typedAccessory.context.id, typedAccessory);
    this.configureThermostat(typedAccessory);
  }

  private async discover(): Promise<void> {
    await this.client.ensureAuthenticated();
    const snapshot = await temperatures(this.client) as TemperatureList;
    const liveIds = new Set<string>();
    const newAccessories: Array<PlatformAccessory<ZoneContext>> = [];

    for (const zone of snapshot.zones) {
      if (!zone.id || this.config.zones?.[zone.id]?.hidden) continue;
      liveIds.add(zone.id);
      this.states.set(zone.id, withTargetState(zone));

      const name = this.config.zones?.[zone.id]?.name || zone.name;
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:temperature:${zone.id}`);
      let accessory = this.accessories.get(zone.id);

      if (!accessory) {
        accessory = new this.api.platformAccessory<ZoneContext>(name, uuid, this.api.hap.Categories.THERMOSTAT);
        accessory.context = { id: zone.id, name };
        this.configureThermostat(accessory);
        this.accessories.set(zone.id, accessory);
        newAccessories.push(accessory);
      } else {
        accessory.context = { id: zone.id, name };
        if (accessory.displayName !== name) accessory.updateDisplayName(name);
        this.updateThermostat(accessory, zone);
      }
    }

    const staleAccessories = [...this.accessories.values()].filter((accessory) => !liveIds.has(accessory.context.id));
    if (newAccessories.length) this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, newAccessories);
    if (staleAccessories.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
      staleAccessories.forEach((accessory) => this.accessories.delete(accessory.context.id));
    }

    this.log.info("Discovered %d Tekmar thermostat zones", liveIds.size);
  }

  private startPolling(): void {
    const intervalMs = Math.max(5, Number(this.config.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS)) * 1000;
    this.pollTimer = setInterval(() => {
      this.refresh().catch((error) => this.log.warn("Failed to refresh Tekmar zones: %s", errorMessage(error)));
    }, intervalMs);
  }

  private async refresh(): Promise<void> {
    const snapshot = await temperatures(this.client) as TemperatureList;
    for (const zone of snapshot.zones) {
      if (!zone.id) continue;
      const existing = this.states.get(zone.id);
      this.states.set(zone.id, { ...zone, lastTargetState: existing?.lastTargetState ?? preferredTargetState(zone) });
      const accessory = this.accessories.get(zone.id);
      if (accessory) this.updateThermostat(accessory, zone);
    }
  }

  private configureThermostat(accessory: PlatformAccessory<ZoneContext>): void {
    accessory
      .getService(this.api.hap.Service.AccessoryInformation)
      ?.setCharacteristic(this.api.hap.Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(this.api.hap.Characteristic.Model, MODEL)
      .setCharacteristic(this.api.hap.Characteristic.SerialNumber, `tekmar-zone-${accessory.context.id}`);

    const service = accessory.getService(this.api.hap.Service.Thermostat) ?? accessory.addService(this.api.hap.Service.Thermostat, accessory.context.name);
    service.setCharacteristic(this.api.hap.Characteristic.Name, accessory.context.name);

    service.getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
      .setProps({ minValue: -40, maxValue: 100, minStep: 0.5 })
      .onGet(() => this.currentTemperature(accessory.context.id));

    service.getCharacteristic(this.api.hap.Characteristic.TargetTemperature)
      .setProps({ minValue: fahrenheitToCelsius(40), maxValue: fahrenheitToCelsius(85), minStep: fahrenheitToCelsiusStep(1) })
      .onGet(() => this.targetTemperature(accessory.context.id))
      .onSet((value) => this.setTargetTemperature(accessory.context.id, Number(value)));

    service.getCharacteristic(this.api.hap.Characteristic.CurrentHeatingCoolingState)
      .onGet(() => this.currentHeatingCoolingState(accessory.context.id));

    service.getCharacteristic(this.api.hap.Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: targetStateValues(this.stateForOptional(accessory.context.id)) })
      .onGet(() => this.targetHeatingCoolingState(accessory.context.id))
      .onSet((value) => this.setTargetHeatingCoolingState(accessory.context.id, Number(value)));

    service.getCharacteristic(this.api.hap.Characteristic.TemperatureDisplayUnits)
      .onGet(() => this.api.hap.Characteristic.TemperatureDisplayUnits.FAHRENHEIT);

    const state = this.states.get(accessory.context.id);
    if (state) this.updateThermostat(accessory, state);
  }

  private updateThermostat(accessory: PlatformAccessory<ZoneContext>, zone: TemperatureZone): void {
    const service = accessory.getService(this.api.hap.Service.Thermostat);
    if (!service) return;

    const state = this.states.get(zone.id ?? "");
    service.updateCharacteristic(this.api.hap.Characteristic.CurrentTemperature, fahrenheitToCelsius(zone.temperatureF ?? 0));
    service.updateCharacteristic(this.api.hap.Characteristic.TargetTemperature, targetTemperatureC(zone));
    service.updateCharacteristic(this.api.hap.Characteristic.CurrentHeatingCoolingState, currentState(zone));
    service.updateCharacteristic(this.api.hap.Characteristic.TargetHeatingCoolingState, state?.lastTargetState ?? preferredTargetState(zone));
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

  private stateForOptional(id: string): ZoneState | undefined {
    return this.states.get(id);
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

function targetStateValues(zone: ZoneState | undefined): TargetHeatingCoolingState[] {
  if (!zone) return [0, 1, 2, 3];
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
