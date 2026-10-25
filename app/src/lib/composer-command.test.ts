import { expect, test } from "bun:test";
import { isUsageCommand } from "./composer-command";
test("only the complete local /usage command bypasses chat submission", () => {
  for (const text of ["/usage", " /USAGE ", "/usage\n"]) expect(isUsageCommand(text)).toBe(true);
  for (const text of ["/usage extra", "What is /usage", "/usagefoo", "", "/us"]) expect(isUsageCommand(text)).toBe(false);
});
