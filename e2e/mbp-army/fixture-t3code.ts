// Loopback orchestration v2 server for DA-082; no provider or Dash HTTP mocks.
const token = "army-t3code-bearer";
const tickets = new Set<string>();
const createdAt = new Date().toISOString();
const thread = { id: "army-thread", title: "ARMY T3 Code planning", createdAt, updatedAt: createdAt, deletedAt: null };
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(request, server) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/auth/websocket-ticket") {
      if (request.headers.get("authorization") !== `Bearer ${token}`
        || request.headers.get("x-t3-orchestration-protocol") !== "2") return new Response(null, { status: 401 });
      const ticket = crypto.randomUUID();
      tickets.add(ticket);
      console.log("ticket issued");
      return Response.json({ ticket });
    }
    if (url.pathname === "/ws" && url.searchParams.get("orchestrationProtocol") === "2"
      && !request.headers.has("authorization") && tickets.delete(url.searchParams.get("wsTicket") ?? "")
      && server.upgrade(request)) return undefined;
    return new Response(null, { status: 404 });
  },
  websocket: {
    message(socket, raw) {
      const frame: unknown = JSON.parse(raw.toString());
      if (typeof frame !== "object" || frame === null || !("_tag" in frame) || frame._tag !== "Request"
        || !("id" in frame) || typeof frame.id !== "string" || !("tag" in frame)) return socket.close(1008);
      if (frame.tag === "orchestration.subscribeShell") {
        console.log("read shell");
        socket.send(JSON.stringify({ _tag: "Chunk", requestId: frame.id, values: [
          { kind: "snapshot", snapshot: { threads: [thread], archivedThreads: [], projects: [] } },
        ] }));
      } else if (frame.tag === "orchestration.getThreadProjection" && "payload" in frame
        && typeof frame.payload === "object" && frame.payload !== null
        && "threadId" in frame.payload && frame.payload.threadId === thread.id) {
        console.log("read thread army-thread");
        socket.send(JSON.stringify({ _tag: "Exit", requestId: frame.id, exit: { _tag: "Success", value: {
          thread, messages: [
            { id: "question", role: "user", text: "What is the next release step?", createdAt },
            { id: "answer", role: "assistant", text: "Review the migration notes first.", createdAt },
          ],
        } } }));
      } else socket.close(1008);
    },
  },
});
console.log(`ready ${server.port}`);
