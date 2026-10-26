import { expect, test } from "bun:test";
import { flowTraceHttp } from "./flow-trace-http";

test("trace endpoint is dev opt-in and authenticated, never a production sink", async () => {
  const req = () => new Request("http://localhost/debug/trace");
  expect((await flowTraceHttp(false)(req(), true))?.status).toBe(404);
  expect((await flowTraceHttp(true)(req(), false))?.status).toBe(401);
});
test("dev collector reads back the exact bounded phone dump and rejects malformed payloads", async () => {
  const handler = flowTraceHttp(true);
  const dump = { calibration: { offsetMs: -100, uncertaintyMs: 1 }, marks: [{ stage: "ink.up", trace_id: "t", generation: 0, at: 123 }] };
  const post = (body: unknown) => handler(new Request("http://localhost/debug/trace", { method: "POST", body: JSON.stringify(body) }), true);
  expect((await post(dump))?.status).toBe(204);
  expect(await (await handler(new Request("http://localhost/debug/trace"), true))?.json()).toEqual(dump);
  expect((await post({ marks: [{}] }))?.status).toBe(400);
  expect((await post({ calibration: null, marks: Array(2049).fill(dump.marks[0]) }))?.status).toBe(400);
  expect(await handler(new Request("http://localhost/other"), true)).toBeNull();
});
