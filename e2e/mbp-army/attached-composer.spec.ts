import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, openChat, composer, send, chatRow, chooseHarness } from "./fixtures";

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath("final.png") });
});

test("attached composer sends into the same ACP session after leaving Chat", async ({ page, bridge }) => {
  await openChat(page, bridge);
  await send(page, "ARMY_H108_FIRST");
  await expect(page.getByTestId("transcript-viewport").getByText("ARMY_REPLY: ARMY_H108_FIRST").first()).toBeVisible({ timeout: 20000 });

  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-composer")).toBeVisible();
  await expect(page.getByTestId("attached-composer-target")).toContainText("OMP");
  // Main must never contain an alternate text copy of the assistant's reply.
  // That would shadow the transcript and break strict text locators across the army.
  await expect(page.getByTestId("attached-composer").getByText(/ARMY_REPLY:/)).toHaveCount(0);

  await composer(page).fill("ARMY_H108_MAIN");
  await page.getByRole("button", { name: "Send", exact: true }).click({ noWaitAfter: true });
  // The fixture ACP peer receives this through the authenticated bridge, not an app debug seed.
  await expect.poll(async () => {
    const log = await readFile(join(bridge.dir, "army-acp-turns.jsonl"), "utf8").catch(() => "");
    return log.includes("ARMY_H108_FIRST") && log.includes("ARMY_H108_MAIN");
  }, { timeout: 20000 }).toBe(true);

  await page.getByRole("button", { name: "Open attached chat", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("transcript-viewport").getByText("ARMY_REPLY: ARMY_H108_FIRST").first()).toBeVisible();
  await expect(page.getByTestId("transcript-viewport").getByText("ARMY_REPLY: ARMY_H108_MAIN").first()).toBeVisible({ timeout: 20000 });
});

test("attached composer keeps per-session draft across tab, search and reload", async ({ page, bridge }) => {
  await openChat(page, bridge);
  const draft = "ARMY_H108_UNSENT_SAME_SESSION";
  await composer(page).fill(draft);
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });

  await expect(page.getByTestId("attached-composer")).toBeVisible();
  await expect(composer(page)).toHaveValue(draft);
  await page.getByRole("tab").nth(0).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-composer")).toBeVisible();
  await expect(composer(page)).toHaveValue(draft);

  await page.getByRole("button", { name: "Search chats and tools", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole("button", { name: "Return to attached session", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Return to attached session", exact: true }).click({ noWaitAfter: true });
  await expect(composer(page)).toHaveValue(draft);

  // Typing a Main search scope into the attached field must open search without
  // replacing the selected chat's durable, unsent draft.
  await composer(page).fill("/harness OMP");
  const harnessResult = page.getByRole("button")
    .filter({ has: page.getByText("OMP", { exact: true }) })
    .filter({ has: page.getByText("Harness", { exact: true }) });
  await expect(harnessResult).toBeVisible();
  await page.getByRole("button", { name: "Return to attached session", exact: true }).click({ noWaitAfter: true });
  await expect(composer(page)).toHaveValue(draft);

  await expect.poll(() => page.evaluate(() => localStorage.getItem("dash.composerDrafts.v1"))).toContain(draft);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dash.activeId.v1"))).not.toBeNull();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("attached-composer")).toBeVisible({ timeout: 25000 });
  await expect(composer(page)).toHaveValue(draft);
});

test("attached composer switches only when a different chat is explicitly chosen", async ({ page, bridge }) => {
  await openChat(page, bridge);
  await send(page, "ARMY_H108_OMP_SCOPE");
  await expect(page.getByTestId("transcript-viewport").getByText("ARMY_REPLY: ARMY_H108_OMP_SCOPE").first()).toBeVisible({ timeout: 20000 });
  const reserved = "ARMY_H108_OMP_RESERVED_DRAFT";
  await composer(page).fill(reserved);
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-composer-target")).toContainText("OMP");
  await expect(composer(page)).toHaveValue(reserved);

  await chatRow(page).click({ noWaitAfter: true });
  await chooseHarness(page, "Hermes");
  await expect(composer(page)).toHaveValue("");
  await send(page, "ARMY_H108_HERMES_SCOPE");
  await expect(page.getByTestId("transcript-viewport").getByText("ARMY_REPLY: ARMY_H108_HERMES_SCOPE").first()).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-composer-target")).toContainText("Hermes");

  // The old OMP row, not the app's default harness, determines the next attachment.
  const oldRow = page.getByTestId("chats-pane").locator('[data-testid^="chat-row-"]').filter({ hasText: "ARMY_H108_OMP_SCOPE" });
  await expect(oldRow).toHaveCount(1, { timeout: 20000 });
  await oldRow.click({ noWaitAfter: true });
  await expect(page.getByTestId("transcript-viewport").getByText("ARMY_REPLY: ARMY_H108_OMP_SCOPE").first()).toBeVisible();
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-composer-target")).toContainText("OMP");
  await expect(composer(page)).toHaveValue(reserved);
});

test("restored saved-local chat keeps its own draft and Main chat search", async ({ page, bridge }) => {
  await openChat(page, bridge);
  await send(page, "ARMY_H108_SAVED_LOCAL_SEED");
  await expect(page.getByTestId("transcript-viewport").getByText("ARMY_REPLY: ARMY_H108_SAVED_LOCAL_SEED").first())
    .toBeVisible({ timeout: 20000 });
  const draft = "ARMY_H108_SAVED_LOCAL_DRAFT";
  await composer(page).fill(draft);
  // Wait for the normal durable index and draft writes before simulating a
  // historical chat whose bridge provenance was lost in a local upgrade.
  await expect.poll(() => page.evaluate(expected => {
    const chats: { id: string; title: string }[] = JSON.parse(localStorage.getItem("dash.conversations.index.v3") || "[]");
    const chat = chats.find(row => row.title.includes("ARMY_H108_SAVED_LOCAL_SEED"));
    const drafts: Record<string, { text: string }> = JSON.parse(localStorage.getItem("dash.composerDrafts.v1") || "{}");
    return Boolean(chat && drafts[chat.id]?.text === expected &&
      localStorage.getItem(`dash.durable.files.v2/${encodeURIComponent(chat.id)}.json`));
  }, draft)).toBe(true);

  const savedId = await page.evaluate(() => {
    const key = "dash.conversations.index.v3";
    const chats: { id: string; title: string; endpointAddress?: string }[] = JSON.parse(localStorage.getItem(key) || "[]");
    const chat = chats.find(row => row.title.includes("ARMY_H108_SAVED_LOCAL_SEED"));
    if (!chat?.endpointAddress) throw Error("Owned chat was not durably indexed");
    delete chat.endpointAddress;
    for (const area of ["durable", "cache"]) {
      const path = `dash.${area}.files.v2/${encodeURIComponent(chat.id)}.json`;
      const raw = localStorage.getItem(path);
      if (!raw) continue;
      const record: { endpointAddress?: string } = JSON.parse(raw);
      delete record.endpointAddress;
      localStorage.setItem(path, JSON.stringify(record));
    }
    localStorage.setItem(key, JSON.stringify(chats));
    return chat.id;
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  const close = page.getByRole("button", { name: "Close chat window", exact: true });
  if (await close.isVisible()) await close.click({ noWaitAfter: true });
  await page.getByRole("tab").nth(1).click({ noWaitAfter: true });
  await expect(page.getByTestId("chats-pane")).toBeVisible();
  await expect(page.getByTestId("attached-composer")).toHaveCount(0);

  const savedRow = page.getByTestId(`chat-row-${savedId}`);
  await expect(savedRow.getByLabel("Saved local history", { exact: true })).toBeVisible();
  await savedRow.click({ noWaitAfter: true });
  await expect(composer(page)).toHaveValue(draft);
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
  // The closing chat window keeps its Message textbox mounted during exit; wait for it
  // to unmount so the search query lands in Main's search bar, not the closing composer.
  await expect(page.getByTestId("chat-window")).toHaveCount(0);
  await expect(page.getByTestId("attached-composer")).toHaveCount(0);
  // First enter the explicit chat-search scope, then verify ordinary discovery
  // also shows the restored saved-local identity rather than silently attaching it.
  await composer(page).fill("@chats ARMY_H108_SAVED_LOCAL_SEED");
  await expect(page.getByText("Chat · saved local", { exact: true })).toBeVisible();
  await composer(page).fill("ARMY_H108_SAVED_LOCAL_SEED");
  await expect(page.getByText("Chat · saved local", { exact: true })).toBeVisible();
});
