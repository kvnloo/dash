import assert from "node:assert/strict";

/** Rendered phone geometry, not source-string or mock layout assertions. */
export async function assertLivingNight(page, scenario) {
  const result = { scenario, viewport: page.viewportSize() };
  assert.deepEqual(result.viewport, { width: 390, height: 844 });
  if (scenario.startsWith("main") || scenario.startsWith("chat") || scenario === "settings") {
    // The restored top navigation bar: Expand · three-dot gel pager · Bridge details, in a 60px band.
    const expand = await page.getByRole("button", { name: "Expand", exact: true }).boundingBox();
    const bridge = await page.getByRole("button", { name: "Bridge details", exact: true }).boundingBox();
    const tabs = [];
    for (const label of ["Bots", "Chats", "Orchestra"]) tabs.push(await page.getByRole("tab", { name: label, exact: true }).boundingBox());
    for (const b of [expand, bridge, ...tabs]) assert.ok(b.y >= 0 && b.y + b.height <= 60, "nav controls sit in the 60px bar");
    assert.ok(expand.x < tabs[0].x && tabs[0].x < tabs[1].x && tabs[1].x < tabs[2].x && tabs[2].x < bridge.x, "Expand, pager, Bridge details in order");
    assert.ok(Math.abs((tabs[1].x + tabs[1].width / 2) - 195) <= 2, "pager is centred on the phone");
    assert.ok(expand.width >= 44 && bridge.width >= 44, "44px nav hit targets");
    result.nav = { expand, bridge, tabs };
  }
  if (scenario.startsWith("main")) {
    const selected = page.getByRole("tab", { selected: true });
    const label = await selected.getAttribute("aria-label");
    const heading = page.getByRole("heading", { name: label, exact: true });
    await heading.waitFor();
    assert.ok((await heading.boundingBox()).y >= 60, "pane title sits under the bar");
    const mention = page.getByRole("button", { name: "Mention", exact: true });
    const box = await mention.boundingBox();
    assert.ok(box.x >= 12 && box.y >= 0 && box.y + box.height <= 844, "@ stays inside the phone dock");
    assert.equal(await mention.innerText(), "@", "@ must be a contained glyph, not an add icon");
    if (scenario.startsWith("main-chats")) {
      const ended = page.getByText("ended", { exact: true });
      await ended.waitFor();
      assert.equal(await ended.evaluate(e => getComputedStyle(e).fontFamily.includes("IBMPlexMono")), true);
      result.ended = await ended.boundingBox();
    }
    if (scenario === "main-chats-search") {
      const list = page.getByRole("list");
      await list.waitFor();
      assert.ok((await list.getByRole("button").count()) >= 3, "focused scope chips visible");
      result.chips = await list.boundingBox();
      assert.ok(result.chips.y < box.y, "scope chips open above dock");
    }
    if (scenario === "main-bots") {
      assert.equal(await page.getByRole("img", { name: /identity orb$/ }).count(), 0, "Bots never shows identity orbs");
      for (const name of [/^Codex/, /^Claude Code/, /^OMP 1/]) assert.equal(await page.getByRole("button", { name }).count(), 0, "harnesses and sessions are not bots");
      const host = page.getByRole("button", { name: /^mbp, 3 bots, online$/ });
      await host.waitFor();
      result.hostHeader = await host.boundingBox();
      assert.ok(result.hostHeader.height >= 44 && result.hostHeader.height <= 52, "host header 44-52px");
      result.botRows = [];
      for (const name of [/^clean, /, /^chiefstaff, /, /^opendots, /]) {
        const b = await page.getByRole("button", { name }).boundingBox();
        assert.ok(b.height >= 44 && b.height <= 56, "bot row stays dense");
        result.botRows.push(b);
      }
    }
    if (scenario === "main-orchestra") {
      const cards = page.getByRole("button").filter({ hasText: "Topology not reported" });
      for (const card of await cards.all()) {
        const b = await card.boundingBox();
        assert.ok(b.width >= 350 && b.x >= 12, "project cards stretch consistently across the phone");
      }
    }
  }
  if (scenario === "chat-attachments") {
    for (const text of ["seedlings.png", "watering-log.txt", "Uploading…", "walkthrough.mov is 39.1 MB. The limit is 25.0 MB per file."]) await page.getByText(text, { exact: true }).first().waitFor();
    const chips = page.getByRole("button", { name: /^Remove / });
    assert.equal(await chips.count(), 3, "one remove control per chip");
    const send = page.getByRole("button", { name: "Send", exact: true });
    assert.equal(await send.isDisabled(), true, "send waits for uploads");
    const share = page.getByRole("button", { name: "Send tray-3-marked.png to phone", exact: true });
    await share.waitFor();
    result.share = await share.boundingBox();
    for (const name of ["Attached tray-3.jpg", "Attached watering-log.txt"]) await page.getByLabel(name, { exact: true }).waitFor();
  }
  if (["chat", "chat-streaming", "chat-attachments"].includes(scenario)) {
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    assert.equal(await input.evaluate(e => e.tagName), "INPUT", "placeholder cannot wrap in a textarea");
    const boxes = [];
    for (const name of ["Attach file", "Voice input", scenario === "chat-streaming" ? "Stop" : "Send"]) boxes.push(await page.getByRole("button", { name, exact: true }).boundingBox());
    for (const b of boxes) assert.ok(b.width >= 44 && b.height >= 44 && b.x + b.width <= 390);
    assert.ok(boxes[0].x < boxes[1].x && boxes[1].x < boxes[2].x);
    assert.equal(boxes[0].y, boxes[1].y);
    assert.equal(boxes[1].y, boxes[2].y);
    result.composerControls = boxes;
    result.input = await input.boundingBox();
    assert.ok(result.input.width > 150, "input keeps usable width next to the single controls row");
  }
  if (scenario === "voice") {
    await page.getByText("Microphone off · Start in z0live", { exact: true }).waitFor();
    assert.ok((await page.locator('iframe[title$="voice orb, idle"]').count()) === 1, "handoff orb stays idle");
  }
  if (scenario === "approvals") {
    for (const label of ["Pending", "Bulk-ready", "Blocked"]) await page.getByText(label, { exact: true }).waitFor();
    result.metrics = await page.getByTestId("approval-metrics").boundingBox();
    assert.ok(result.metrics.width <= 390 && result.metrics.height < 150);
    await page.getByText("Dry run · Nothing will be posted", { exact: true }).waitFor();
  }
  return result;
}

/** Fixture-only real UI journeys. No microphone grant or approval is submitted. */
export async function exerciseLivingNight(page, scenario) {
  const steps = [];
  if (scenario === "main-chats") {
    for (const label of ["Bots", "Chats", "Orchestra", "Chats"]) {
      await page.getByRole("tab", { name: label, exact: true }).click();
      await page.getByRole("tab", { name: label, selected: true, exact: true }).waitFor();
      await page.getByRole("heading", { name: label, exact: true }).waitFor();
    }
    steps.push("switch Bots / Chats / Orchestra / Chats with the dot pager; the header names the pane");
    await page.getByRole("button", { name: "Bridge details", exact: true }).click();
    await page.getByRole("button", { name: "Edit bridge", exact: true }).waitFor();
    const dismiss = page.getByRole("button", { name: "Dismiss bridge details", exact: true });
    const dim = await dismiss.boundingBox();
    await dismiss.click({ position: { x: dim.width / 2, y: dim.height - 12 } });
    await page.getByRole("button", { name: "Edit bridge", exact: true }).waitFor({ state: "hidden" });
    steps.push("bridge details opens and dismisses without blocking tabs");
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.getByRole("button", { name: "Attach file", exact: true }).waitFor();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("tab", { name: "Chats", selected: true, exact: true }).waitFor();
    steps.push("compose opens chat; Back returns to Chats");
  }
  if (scenario === "main-bots") {
    const host = page.getByRole("button", { name: /^mbp, 3 bots, online$/ });
    await host.click();
    await page.getByRole("button", { name: /^clean, / }).waitFor({ state: "hidden" });
    await host.click();
    await page.getByRole("button", { name: /^clean, / }).waitFor();
    steps.push("host section collapses and expands");
  }
  if (scenario === "main-chats-search") {
    await page.getByRole("textbox", { name: "Message", exact: true }).blur();
    await page.getByRole("list").waitFor({ state: "hidden" });
    await page.getByRole("textbox", { name: "Message", exact: true }).focus();
    await page.getByRole("list").waitFor();
    steps.push("scope chips disappear on blur and reopen on focus");
  }
  if (scenario === "chat-streaming") {
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.getByRole("button", { name: "Send", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Stop", exact: true }).count(), 0);
    steps.push("Stop settles fixture turn and restores send");
  }
  if (scenario === "voice") {
    await page.getByRole("radio", { name: "Voice appearance: chatgpt", exact: true }).click();
    await page.locator('iframe[title="chatgpt voice orb, idle"]').waitFor();
    await page.getByText("Microphone off · Start in z0live", { exact: true }).waitFor();
    steps.push("appearance switches without claiming microphone activity");
  }
  if (scenario === "approvals") {
    await page.getByRole("button", { name: "Select all bulk-safe", exact: true }).click();
    // Two bulk-safe fixtures (a titled comment and an untitled review reply).
    const approve = page.getByRole("button", { name: "Approve selected (2)", exact: true });
    assert.equal(await approve.isEnabled(), true);
    await approve.click();
    await page.getByText("Approve 2 items?", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByText("Approve 2 items?", { exact: true }).waitFor({ state: "hidden" });
    steps.push("bulk selection opens exact confirmation; Cancel submits nothing");
  }
  return steps;
}
