import { test, expect, openChat, send, web } from "./fixtures";
import { enterAnnotation } from "./annotation";

for (const engine of ["tldraw", "skia"]) {
  test(`DeX Pad pinches the TV chat and sends a circle drawn on the phone (${engine})`, async ({ page, bridge }, info) => {
    await page.setViewportSize({ width: 1200, height: 780 });
    await openChat(page, bridge, `${web}?annotateEngine=${engine}`);
    await send(page, "TV chat seed");
    await expect(page.getByText(/ARMY_REPLY: TV chat seed/).first()).toBeVisible();
    await page.evaluate("window.__dashDex.simulate({ mode: 'dual' })");
    // Exercise the same user-facing launch affordance as the native TV.
    const tv = page.getByTestId("dex-tv");
    const pad = page.getByTestId("dex-pad");
    await pad.getByRole("button", { name: "Touchpad", exact: true }).click();
    await enterAnnotation(page);
    const openPad = tv.getByRole("button", { name: "Open Dash Pad on phone", exact: true });
    await openPad.click();
    const shape = tv.locator('[data-shape-type="draw"]');
    if (engine === "tldraw") await expect(tv.getByTestId("annotate-tldraw")).toHaveAttribute("data-ready", "true");
    else await expect(tv.getByTestId("annotation-overlay").locator("canvas")).toBeVisible();
    const sendInk = tv.getByRole("button", { name: "Send annotation", exact: true });

    const surface = pad.getByTestId("dex-pad-surface");
    const bounds = await surface.boundingBox();
    if (!bounds) throw new Error("Dash Pad drawing surface is missing");
    const point = (id: number, x: number, y: number) => ({
      id, x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y,
    });
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", touchPoints: ReturnType<typeof point>[] = []) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    try {
      await touch("touchStart", [point(0, .4, .5)]);
      await touch("touchStart", [point(0, .4, .5), point(1, .6, .5)]);
      await touch("touchMove", [point(0, .3, .5), point(1, .7, .5)]);
      await touch("touchEnd");

      const zoomed = tv.getByTestId("dex-zoomed-chat");
      await expect(zoomed.getByText(/ARMY_REPLY: TV chat seed/).first()).toBeAttached();
      await expect.poll(() => zoomed.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a)).toBeCloseTo(2, 1);
      await expect(sendInk).toBeDisabled();

      // A cancelled contact must leave no phantom stroke.
      await touch("touchStart", [point(0, .3, .45)]);
      await touch("touchMove", [point(0, .45, .56)]);
      await touch("touchCancel");
      await expect(sendInk).toBeDisabled();

      const radius = Math.min(bounds.width, bounds.height) * .2;
      const circle = Array.from({ length: 25 }, (_, index) => {
        const theta = index / 24 * 2 * Math.PI;
        return point(0, .5 + radius / bounds.width * Math.cos(theta), .6 + radius / bounds.height * Math.sin(theta));
      });
      await touch("touchStart", circle.slice(0, 1));
      for (const p of circle.slice(1)) await touch("touchMove", [p]);
      await touch("touchEnd");
    } finally {
      await cdp.detach();
    }
    if (engine === "tldraw") await expect(shape).toBeVisible();
    await expect(sendInk).toBeEnabled();
    await page.screenshot({ path: info.outputPath("pad-circle-on-tv.png") });

    // Check both reset-with-retained-ink and sending directly from a zoomed view.
    if (engine === "tldraw") {
      await pad.getByRole("button", { name: "Reset zoom", exact: true }).click();
      await expect(tv.getByTestId("dex-zoomed-chat")).toHaveCount(0);
      await expect(shape).toHaveCount(1);
    }
    const uploaded = page.waitForRequest(request => request.method() === "POST" &&
      request.url().includes("/attachments?") && request.headers()["content-type"] === "application/json");
    await sendInk.click();
    await tv.getByRole("button", { name: "Send anyway", exact: true }).click();
    const doc = (await uploaded).postDataJSON();
    expect(doc.strokes).toHaveLength(1);
    expect(doc.strokes[0].pointer).toBe("touch");
    const points: number[][] = doc.strokes[0].points;
    expect(points.length).toBeGreaterThan(12);
    const expectedX = .5 + Math.min(1, bounds.height / bounds.width) * .1;
    expect(points[0]?.[0]).toBeCloseTo(expectedX, 2);
    expect(points.at(-1)?.[0]).toBeCloseTo(expectedX, 2);
    expect(points[0]?.[1]).toBeCloseTo(.55, 2);
    await expect(tv.getByText(/ARMY_REPLY: Annotated/).first()).toBeVisible();
  });
}
