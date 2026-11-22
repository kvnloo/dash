import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { createBridge, expect, pair, test } from "./fixtures";

test("Chats lists T3 Code threads and opens their transcripts", async ({ page }, info) => {
  const server = spawn("bun", [join(__dirname, "fixture-t3code.ts")], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit");
  let log = "";
  server.stdout.on("data", chunk => { log += chunk; });
  server.stderr.on("data", chunk => { log += chunk; });
  try {
    let port: string | undefined;
    await expect.poll(() => (port = /^ready (\d+)$/m.exec(log)?.[1])).toBeTruthy();
    const bridge = await createBridge(false, { env: {
      DASH_T3CODE_SERVER: `http://127.0.0.1:${port}`, DASH_T3CODE_TOKEN: "army-t3code-bearer",
    } });
    try {
      await pair(page, bridge);
      const row = page.getByRole("button").filter({ has: page.getByText("ARMY T3 Code planning", { exact: true }) });
      await expect(row.getByLabel("View only")).toBeVisible();
      await row.click();
      const chat = page.getByTestId("chat-window");
      await expect(chat.getByText("What is the next release step?", { exact: true })).toBeVisible();
      await expect(chat.getByText("Review the migration notes first.", { exact: true })).toBeVisible();
      expect(log.match(/^ticket issued$/gm)).toHaveLength(2);
      expect(log).toContain("read shell");
      expect(log).toContain("read thread army-thread");
      await page.screenshot({ path: info.outputPath("final.png") });
    } finally {
      await bridge.dispose();
      await writeFile(info.outputPath("bridge.log"), bridge.logs());
    }
  } finally {
    server.kill();
    await exited;
    await writeFile(info.outputPath("t3code.log"), log);
  }
});
