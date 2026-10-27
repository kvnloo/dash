import { afterEach, expect, test } from "bun:test";

const base = { name: "Dash", slug: "dash", scheme: "dash", android: { package: "app.dash.mobile", versionCode: 1 }, plugins: ["expo-dev-client", "expo-router"] };
const saved = { app: process.env.DASH_APP_VARIANT, variant: process.env.DASH_VARIANT };
afterEach(() => {
  if (saved.app === undefined) delete process.env.DASH_APP_VARIANT; else process.env.DASH_APP_VARIANT = saved.app;
  if (saved.variant === undefined) delete process.env.DASH_VARIANT; else process.env.DASH_VARIANT = saved.variant;
});
const load = () => require("../app.config.js")({ config: structuredClone(base) });

test("the default build keeps the live applicationId and scheme", () => {
  delete process.env.DASH_APP_VARIANT; delete process.env.DASH_VARIANT;
  const config = load();
  expect(config.android.package).toBe("app.dash.mobile");
  expect(config.scheme).toBe("dash");
  expect(config.plugins).toContain("expo-dev-client");
});

test("the e2e variant installs beside the live app: own applicationId, name and scheme", () => {
  process.env.DASH_APP_VARIANT = "e2e"; process.env.DASH_VARIANT = "release";
  const config = load();
  expect(config.android.package).toBe("app.dash.mobile.e2e");
  expect(config.android.versionCode).toBe(1);
  expect(config.name).toBe("Dash E2E");
  expect(config.scheme).toBe("dash-e2e");
  expect(config.plugins).not.toContain("expo-dev-client");
});
