/**
 * Capture on the Android test device with:
 *   adb shell dumpsys battery
 *   adb shell dumpsys thermalservice
 *
 * Pure parsers only: no adb invocation, device access, or collection side effects.
 * Reject incomplete/ambiguous readings rather than treating unknown state as safe.
 */

export type PluggedSource = "ac" | "usb" | "wireless" | "none";

export interface BatteryState {
  batteryPct: number;
  temperatureC: number;
  plugged: PluggedSource;
  statusCode: number;
}

export type ThermalStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type ThermalName =
  | "NONE"
  | "LIGHT"
  | "MODERATE"
  | "SEVERE"
  | "CRITICAL"
  | "EMERGENCY"
  | "SHUTDOWN";

export interface ThermalState {
  thermalStatus: ThermalStatus;
  name: ThermalName;
}

export type DeviceState = BatteryState & ThermalState;
export type DeviceStateParseErrorCode = "missing" | "invalid" | "ambiguous";

export class DeviceStateParseError extends Error {
  constructor(
    readonly code: DeviceStateParseErrorCode,
    readonly source: "battery" | "thermal",
    readonly field: string,
    detail: string,
  ) {
    super(source + ": " + field + ": " + detail);
    this.name = "DeviceStateParseError";
  }
}

const BATTERY_KEYS = new Set([
  "level",
  "scale",
  "temperature",
  "status",
  "ac powered",
  "usb powered",
  "wireless powered",
]);

function batteryFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^:\r\n]+?)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1]?.trim().toLowerCase();
    const value = match[2]?.trim();
    if (!key || value === undefined || !BATTERY_KEYS.has(key)) continue;
    const previous = fields.get(key);
    if (previous !== undefined && previous !== value) {
      throw new DeviceStateParseError("ambiguous", "battery", key, "conflicting values");
    }
    fields.set(key, value);
  }
  return fields;
}

function requiredBatteryField(fields: ReadonlyMap<string, string>, field: string): string {
  const value = fields.get(field);
  if (value === undefined) {
    throw new DeviceStateParseError("missing", "battery", field, "field not found");
  }
  return value;
}

function batteryInteger(fields: ReadonlyMap<string, string>, field: string): number {
  const raw = requiredBatteryField(fields, field);
  if (!/^-?\d+$/.test(raw)) {
    throw new DeviceStateParseError("invalid", "battery", field, "expected an integer");
  }
  const number = Number(raw);
  if (!Number.isSafeInteger(number)) {
    throw new DeviceStateParseError("invalid", "battery", field, "integer out of range");
  }
  return number;
}

function batteryPower(fields: ReadonlyMap<string, string>, field: string): boolean {
  const raw = requiredBatteryField(fields, field).toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new DeviceStateParseError("invalid", "battery", field, "expected true or false");
}

export function parseBattery(text: string): BatteryState {
  const fields = batteryFields(text);
  const level = batteryInteger(fields, "level");
  const scale = batteryInteger(fields, "scale");
  const temperature = batteryInteger(fields, "temperature");
  const statusCode = batteryInteger(fields, "status");

  if (scale <= 0 || level < 0 || level > scale) {
    throw new DeviceStateParseError("invalid", "battery", "level/scale", "out of range");
  }
  if (statusCode < 0) {
    throw new DeviceStateParseError("invalid", "battery", "status", "negative status");
  }

  const ac = batteryPower(fields, "ac powered");
  const usb = batteryPower(fields, "usb powered");
  const wireless = batteryPower(fields, "wireless powered");
  if (Number(ac) + Number(usb) + Number(wireless) > 1) {
    throw new DeviceStateParseError("ambiguous", "battery", "powered", "multiple power sources");
  }

  const plugged: PluggedSource = ac ? "ac" : usb ? "usb" : wireless ? "wireless" : "none";
  return {
    batteryPct: Math.round((level * 100) / scale),
    temperatureC: temperature / 10,
    plugged,
    statusCode,
  };
}

function thermalReading(raw: string): ThermalState {
  if (!/^\d+$/.test(raw)) {
    throw new DeviceStateParseError("invalid", "thermal", "Thermal Status", "expected 0 through 6");
  }
  switch (Number(raw)) {
    case 0: return { thermalStatus: 0, name: "NONE" };
    case 1: return { thermalStatus: 1, name: "LIGHT" };
    case 2: return { thermalStatus: 2, name: "MODERATE" };
    case 3: return { thermalStatus: 3, name: "SEVERE" };
    case 4: return { thermalStatus: 4, name: "CRITICAL" };
    case 5: return { thermalStatus: 5, name: "EMERGENCY" };
    case 6: return { thermalStatus: 6, name: "SHUTDOWN" };
    default:
      throw new DeviceStateParseError("invalid", "thermal", "Thermal Status", "out of range");
  }
}

export function parseThermal(text: string): ThermalState {
  let rawStatus: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*Thermal Status\s*:\s*(.*?)\s*$/i.exec(line);
    if (!match) continue;
    const value = match[1]?.trim() ?? "";
    if (rawStatus !== undefined && rawStatus !== value) {
      throw new DeviceStateParseError("ambiguous", "thermal", "Thermal Status", "conflicting values");
    }
    rawStatus = value;
  }
  if (rawStatus === undefined) {
    throw new DeviceStateParseError("missing", "thermal", "Thermal Status", "field not found");
  }
  return thermalReading(rawStatus);
}

export interface RunAdmissionLimits {
  maxThermal?: number;
  minBatteryPct?: number;
  maxTemperatureC?: number;
}

export interface RunAdmissionResult {
  ok: boolean;
  reasons: string[];
}

export function admitRun(
  state: Pick<DeviceState, "batteryPct" | "temperatureC" | "thermalStatus">,
  { maxThermal = 1, minBatteryPct = 20, maxTemperatureC = 40 }: RunAdmissionLimits = {},
): RunAdmissionResult {
  const reasons: string[] = [];

  const validThermalLimit = Number.isInteger(maxThermal) && maxThermal >= 0 && maxThermal <= 6;
  const validBatteryLimit = Number.isFinite(minBatteryPct) && minBatteryPct >= 0 && minBatteryPct <= 100;
  const validTemperatureLimit = Number.isFinite(maxTemperatureC);
  if (!validThermalLimit) reasons.push("Invalid maxThermal limit");
  if (!validBatteryLimit) reasons.push("Invalid minBatteryPct limit");
  if (!validTemperatureLimit) reasons.push("Invalid maxTemperatureC limit");

  if (!Number.isInteger(state.thermalStatus) || state.thermalStatus < 0 || state.thermalStatus > 6) {
    reasons.push("Invalid thermal status");
  } else if (validThermalLimit && state.thermalStatus > maxThermal) {
    reasons.push("Thermal status " + state.thermalStatus + " exceeds maximum " + maxThermal);
  }

  if (!Number.isFinite(state.batteryPct) || state.batteryPct < 0 || state.batteryPct > 100) {
    reasons.push("Invalid battery percentage");
  } else if (validBatteryLimit && state.batteryPct < minBatteryPct) {
    reasons.push("Battery " + state.batteryPct + "% below minimum " + minBatteryPct + "%");
  }

  if (!Number.isFinite(state.temperatureC)) {
    reasons.push("Invalid battery temperature");
  } else if (validTemperatureLimit && state.temperatureC > maxTemperatureC) {
    reasons.push("Battery temperature " + state.temperatureC + " C exceeds maximum " + maxTemperatureC + " C");
  }

  return { ok: reasons.length === 0, reasons };
}
