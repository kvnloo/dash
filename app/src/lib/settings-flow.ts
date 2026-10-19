import type { Connection, Settings } from "../model";

interface SettingsConnection {
  get(): { connection: Connection };
  subscribe(listener: () => void): () => void;
}

interface ConnectSettingsInput {
  settings: Settings;
  connection: SettingsConnection;
  save(settings: Settings): void;
  start(settings: Settings): void;
  onConnected(): void;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function connectSettings(input: ConnectSettingsInput): Promise<void> {
  if (input.signal?.aborted) throw new Error("Connection cancelled");
  input.save(input.settings);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve();
    };
    const inspect = () => {
      const connection = input.connection.get().connection;
      if (connection.status === "online") finish();
      else if (connection.status === "offline") finish(new Error(connection.error ?? "Can't reach the bridge"));
    };
    const cancel = () => finish(new Error("Connection cancelled"));
    const unsubscribe = input.connection.subscribe(inspect);
    const timer = setTimeout(() => finish(new Error("Timed out connecting to the bridge")), input.timeoutMs ?? 8000);
    input.signal?.addEventListener("abort", cancel, { once: true });
    try {
      input.start(input.settings);
      inspect();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
  if (input.signal?.aborted) throw new Error("Connection cancelled");
  input.onConnected();
}
