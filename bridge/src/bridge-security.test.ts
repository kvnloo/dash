import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBridgeSecrets, resolveBridgeHost } from "./bridge-security";

describe("bridge bind policy", () => {
  test("defaults to the detected tailnet address", () => {
    expect(resolveBridgeHost({ tailnetIp: "100.90.10.4" })).toBe("100.90.10.4");
  });

  test("fails closed without a valid detected tailnet", () => {
    for (const tailnetIp of [null, "100.1.2.3", "100.128.2.3", "192.168.1.2", "0.0.0.0"]) {
      expect(() => resolveBridgeHost({ tailnetIp })).toThrow();
    }
  });

  test("rejects wildcard, LAN, and other tailnet addresses", () => {
    for (const requestedHost of ["0.0.0.0", "::", "192.168.1.2", "100.90.10.5", "localhost", "127.0.0.1"]) {
      expect(() => resolveBridgeHost({ tailnetIp: "100.90.10.4", requestedHost })).toThrow();
    }
  });

  test("loopback needs both an explicit host and isolated-test opt in", () => {
    expect(resolveBridgeHost({ tailnetIp: null, requestedHost: "127.0.0.1", allowLoopback: true })).toBe("127.0.0.1");
    expect(resolveBridgeHost({ tailnetIp: null, requestedHost: "::1", allowLoopback: true })).toBe("::1");
    expect(() => resolveBridgeHost({ tailnetIp: null, allowLoopback: true })).toThrow();
    expect(() => resolveBridgeHost({ tailnetIp: null, requestedHost: "0.0.0.0", allowLoopback: true })).toThrow();
  });
});

test("bootstrap and execution secrets are distinct, private, and persistent", () => {
  const directory = mkdtempSync(join(tmpdir(), "dash-security-"));
  try {
    const first = loadBridgeSecrets(directory);
    const second = loadBridgeSecrets(directory);
    expect(first).toEqual(second);
    expect(first.bootstrapToken === first.token).toBe(false);
    expect(first.bootstrapToken.length >= 32).toBe(true);
    expect(first.token.length >= 32).toBe(true);
    expect(statSync(join(directory, "bootstrap-token")).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "token")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(directory, "bootstrap-token"), "utf8").trim() === first.bootstrapToken).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid or reused persisted credentials fail closed", async () => {
  const { writeFileSync } = await import("node:fs");
  const directory = mkdtempSync(join(tmpdir(), "dash-security-invalid-"));
  try {
    writeFileSync(join(directory, "token"), "valid-execution-token-for-this-fixture");
    writeFileSync(join(directory, "bootstrap-token"), "short");
    expect(() => loadBridgeSecrets(directory)).toThrow("Invalid Dash bootstrap-token");
    writeFileSync(join(directory, "bootstrap-token"), "valid-execution-token-for-this-fixture");
    expect(() => loadBridgeSecrets(directory)).toThrow("must be distinct");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
