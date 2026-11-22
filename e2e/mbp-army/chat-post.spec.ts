import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { test, expect, pair, LONG_CHAT_TITLE, LONG_HERMES_TITLE } from "./fixtures";

const exec = promisify(execFile);
test.use({ bridgeOptions: { longClaude: true, longHermes: true } });

test("dash-post delivers into only the named chat and replays once after reload", async ({ page, bridge }, info) => {
  const noticePort = /notices\s+http:\/\/127\.0\.0\.1:(\d+)/.exec(bridge.logs())?.[1];
  if (!noticePort) throw new Error("Fixture reporting listener did not bind");
  const cli = (title: string, message: string) => exec("bun", [
    resolve(__dirname, "../../bridge/bin/dash-post"), title, message,
  ], { env: { ...process.env, DASH_CREDENTIAL_DIR: join(bridge.dir, ".dash"), DASH_NOTICE_PORT: noticePort } });
  const rows = page.getByTestId("chats-pane").locator('[data-testid^="chat-row-"]');
  const target = rows.filter({ has: page.getByText(LONG_CHAT_TITLE, { exact: true }) });
  const other = rows.filter({ has: page.getByText(LONG_HERMES_TITLE, { exact: true }) });
  const post = page.getByTestId("agent-chat-post").getByText("Your build is ready.", { exact: true });
  await pair(page, bridge);
  await target.click({ timeout: 30000 });
  await expect(page.getByTestId("transcript-viewport")).toBeVisible();
  await expect(cli("no such named chat", "Do not deliver")).rejects.toThrow("no chat has that exact title");
  const delivered = await cli(LONG_CHAT_TITLE, "Your build is ready.");
  expect(delivered.stdout.trim()).toMatch(/^[0-9a-f-]{36}$/);
  await expect(post).toBeInViewport({ timeout: 10_000 });
  expect(bridge.logs()).toMatch(/chat_post.published/);
  await page.screenshot({ path: info.outputPath("named-chat-post.png") });
  await page.getByRole("button", { name: "Close chat window", exact: true }).click();
  await other.click();
  await expect(page.getByTestId("transcript-viewport")).toBeVisible();
  await expect(post).toHaveCount(0);
  await page.reload();
  await page.getByRole("tab").nth(1).click();
  await target.click();
  await expect(post).toBeVisible();
  await expect(post).toHaveCount(1);
});
