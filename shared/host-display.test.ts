import { expect, test } from "bun:test";
import { hostDisplayName } from "./host-display";

test("host display uses the computer name without rewriting its routing ID", () => {
  const host = { id: "0", name: "0", hostname: "groot" };
  expect(hostDisplayName(host)).toBe("groot");
  expect(host.id).toBe("0");
  expect(hostDisplayName({ id: "routing", name: "tailnet", hostname: " " })).toBe("tailnet");
  expect(hostDisplayName({ id: "routing", name: " ", hostname: "" })).toBe("routing");
});
