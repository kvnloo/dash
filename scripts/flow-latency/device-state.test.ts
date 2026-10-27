import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DeviceStateParseError,
  admitRun,
  parseBattery,
  parseThermal,
} from "./device-state";

const batteryDump = readFileSync(new URL("./fixtures/dumpsys-battery.txt", import.meta.url), "utf8");
const thermalDump = readFileSync(new URL("./fixtures/dumpsys-thermal.txt", import.meta.url), "utf8");

function expectParseError(
  parse: () => unknown,
  source: "battery" | "thermal",
  code: "missing" | "invalid" | "ambiguous",
  field: string,
): void {
  try {
    parse();
  } catch (error) {
    expect(error).toBeInstanceOf(DeviceStateParseError);
    if (!(error instanceof DeviceStateParseError)) throw error;
    expect(error.source).toBe(source);
    expect(error.code).toBe(code);
    expect(error.field).toBe(field);
    return;
  }
  throw new Error("Expected DeviceStateParseError for " + source + ": " + field);
}

describe("parseBattery", () => {
  test("parses a real-format synthetic dump with tenths of Celsius and USB charging", () => {
    expect(parseBattery(batteryDump)).toEqual({
      batteryPct: 64,
      temperatureC: 31.5,
      plugged: "usb",
      statusCode: 2,
    });
  });

  test("ignores unknown fields, tolerates CRLF and differently cased values", () => {
    const text = batteryDump
      .replace("USB powered: true", "USB powered: TRUE")
      .replace(/\n/g, "\r\n") + "\r\nUnrelated key: ignored\r\n";
    expect(parseBattery(text)).toEqual({
      batteryPct: 64,
      temperatureC: 31.5,
      plugged: "usb",
      statusCode: 2,
    });
  });

  test("rounds level / scale instead of assuming scale 100", () => {
    const text = batteryDump.replace("level: 64", "level: 2").replace("scale: 100", "scale: 3");
    expect(parseBattery(text).batteryPct).toBe(67);
  });

  test("recognizes AC, wireless and unplugged without conflating sources", () => {
    const noUsb = batteryDump.replace("USB powered: true", "USB powered: false");
    expect(parseBattery(noUsb).plugged).toBe("none");
    expect(parseBattery(noUsb.replace("AC powered: false", "AC powered: true")).plugged).toBe("ac");
    expect(parseBattery(noUsb.replace("Wireless powered: false", "Wireless powered: true")).plugged).toBe("wireless");
  });

  test("allows temperatures below zero while retaining exact tenths", () => {
    const text = batteryDump.replace("temperature: 315", "temperature: -35");
    expect(parseBattery(text).temperatureC).toBe(-3.5);
  });

  test("requires the complete battery snapshot instead of inventing safe values", () => {
    expectParseError(() => parseBattery(""), "battery", "missing", "level");
    expectParseError(
      () => parseBattery(batteryDump.replace("scale: 100\n", "")),
      "battery",
      "missing",
      "scale",
    );
    expectParseError(
      () => parseBattery(batteryDump.replace("USB powered: true\n", "")),
      "battery",
      "missing",
      "usb powered",
    );
  });

  test("rejects invalid battery numeric values and bounds", () => {
    expectParseError(
      () => parseBattery(batteryDump.replace("level: 64", "level: NaN")),
      "battery",
      "invalid",
      "level",
    );
    expectParseError(
      () => parseBattery(batteryDump.replace("level: 64", "level: 9007199254740992")),
      "battery",
      "invalid",
      "level",
    );
    expectParseError(
      () => parseBattery(batteryDump.replace("scale: 100", "scale: 0")),
      "battery",
      "invalid",
      "level/scale",
    );
    expectParseError(
      () => parseBattery(batteryDump.replace("level: 64", "level: 101")),
      "battery",
      "invalid",
      "level/scale",
    );
    expectParseError(
      () => parseBattery(batteryDump.replace("status: 2", "status: -1")),
      "battery",
      "invalid",
      "status",
    );
  });

  test("rejects invalid power flags, simultaneous sources and conflicting duplicate readings", () => {
    expectParseError(
      () => parseBattery(batteryDump.replace("AC powered: false", "AC powered: perhaps")),
      "battery",
      "invalid",
      "ac powered",
    );
    expectParseError(
      () => parseBattery(batteryDump.replace("AC powered: false", "AC powered: true")),
      "battery",
      "ambiguous",
      "powered",
    );
    expectParseError(
      () => parseBattery(batteryDump + "\nlevel: 11\n"),
      "battery",
      "ambiguous",
      "level",
    );
  });

  test("accepts repeated identical readings from concatenated battery dumps", () => {
    expect(parseBattery(batteryDump + "\nlevel: 64\n").batteryPct).toBe(64);
  });
});

describe("parseThermal", () => {
  test("reads thermal status 2 as MODERATE from the synthetic dump", () => {
    expect(parseThermal(thermalDump)).toEqual({
      thermalStatus: 2,
      name: "MODERATE",
    });
  });

  test("maps all seven Android thermal service levels", () => {
    const names = [
      "NONE",
      "LIGHT",
      "MODERATE",
      "SEVERE",
      "CRITICAL",
      "EMERGENCY",
      "SHUTDOWN",
    ];
    for (const [index, name] of names.entries()) {
      expect(parseThermal("Thermal Status: " + index)).toEqual({
        thermalStatus: index,
        name,
      });
    }
  });

  test("ignores unrelated numeric temperatures and accepts CRLF/case differences", () => {
    const text = thermalDump.replace("Thermal Status: 2", "thermal status: 2").replace(/\n/g, "\r\n");
    expect(parseThermal(text)).toEqual({ thermalStatus: 2, name: "MODERATE" });
  });

  test("throws a typed error if Thermal Status is absent, never defaults to NONE", () => {
    expectParseError(
      () => parseThermal("Current temperatures from HAL:\n  mStatus=2\n"),
      "thermal",
      "missing",
      "Thermal Status",
    );
    expectParseError(() => parseThermal(""), "thermal", "missing", "Thermal Status");
  });

  test("rejects malformed, empty and out-of-range statuses", () => {
    for (const value of ["", "-1", "7", "NaN", "1.5", "2 junk"]) {
      expectParseError(
        () => parseThermal("Thermal Status: " + value),
        "thermal",
        "invalid",
        "Thermal Status",
      );
    }
  });

  test("rejects disagreeing status lines but tolerates exact duplicates", () => {
    expect(parseThermal(thermalDump + "\nThermal Status: 2\n").thermalStatus).toBe(2);
    expectParseError(
      () => parseThermal(thermalDump + "\nThermal Status: 1\n"),
      "thermal",
      "ambiguous",
      "Thermal Status",
    );
  });
});

describe("admitRun", () => {
  test("rejects MODERATE thermal state with the default LIGHT maximum", () => {
    const result = admitRun({ ...parseBattery(batteryDump), ...parseThermal(thermalDump) });
    expect(result.ok).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/Thermal status 2 exceeds maximum 1/);
  });

  test("reports both low battery and high temperature, not just the first failure", () => {
    const result = admitRun({ batteryPct: 15, temperatureC: 41, thermalStatus: 0 });
    expect(result.ok).toBe(false);
    expect(result.reasons).toHaveLength(2);
    expect(result.reasons[0]).toMatch(/Battery 15% below minimum 20%/);
    expect(result.reasons[1]).toMatch(/temperature 41 C exceeds maximum 40 C/);
  });

  test("lists all three failures when thermal, battery and temperature are unsafe", () => {
    const result = admitRun({ batteryPct: 15, temperatureC: 41, thermalStatus: 3 });
    expect(result.ok).toBe(false);
    expect(result.reasons).toHaveLength(3);
    expect(result.reasons[0]).toMatch(/Thermal/);
    expect(result.reasons[1]).toMatch(/Battery 15%/);
    expect(result.reasons[2]).toMatch(/temperature 41 C/);
  });

  test("admits exact inclusive thresholds and cooler charged devices", () => {
    expect(admitRun({ batteryPct: 20, temperatureC: 40, thermalStatus: 1 })).toEqual({
      ok: true,
      reasons: [],
    });
    expect(admitRun({ batteryPct: 100, temperatureC: 25, thermalStatus: 0 })).toEqual({
      ok: true,
      reasons: [],
    });
  });

  test("honors caller limits instead of always applying defaults", () => {
    const state: Pick<import("./device-state").DeviceState, "batteryPct" | "temperatureC" | "thermalStatus"> = { batteryPct: 15, temperatureC: 41, thermalStatus: 2 };
    expect(admitRun(state, {
      maxThermal: 2,
      minBatteryPct: 15,
      maxTemperatureC: 41,
    })).toEqual({ ok: true, reasons: [] });
  });

  test("fails closed on non-finite state readings", () => {
    const result = admitRun({ batteryPct: Number.NaN, temperatureC: Infinity, thermalStatus: 0 });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(["Invalid battery percentage", "Invalid battery temperature"]);
  });

  test("fails closed on malformed configured thresholds", () => {
    const result = admitRun(
      { batteryPct: 80, temperatureC: 30, thermalStatus: 0 },
      { maxThermal: 7, minBatteryPct: -1, maxTemperatureC: Number.NaN },
    );
    expect(result).toEqual({
      ok: false,
      reasons: [
        "Invalid maxThermal limit",
        "Invalid minBatteryPct limit",
        "Invalid maxTemperatureC limit",
      ],
    });
  });
});
