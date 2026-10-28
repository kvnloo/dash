// Persisted device telemetry fixture and read-back, used only by the army's isolated bridge.
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { HostUtilizationStore } from "../../bridge/src/host-utilization";
const [mode, home, hostId] = process.argv.slice(2);
if (!home?.includes("dash-army-") || !hostId) throw new Error("isolated army HOME and host required");
const path = join(home, ".local/state/dash/hosts.db");
const now = Date.now(), minute = 60000, day = 24 * 60 * minute;
if (mode === "seed") {
  const store = new HostUtilizationStore(path);
  store.record(Array.from({ length: 6 }, (_, i) => ({
    hostId, ts: Math.floor(now / (60 * minute)) * 60 * minute - 50 * minute + i * minute, duration: minute,
    cpuPct: i < 4 ? 20 : null, gpuPct: i === 0 ? 70 : null,
    online: i !== 4, state: i < 4 ? "observed" : i === 4 ? "offline" : "lock-timeout",
  })), now);
  store.close();
  const db = new Database(path);
  db.query("INSERT INTO utilization_samples VALUES (?,?,?,?,?,?,?)").run(now - 15 * day, hostId, 99, null, 1, "observed", minute);
  db.query("INSERT INTO utilization_hourly VALUES (?,?,?,?,?,?,?,?,?,?)").run(now - 401 * day, hostId, minute, minute, 1, 1, 99, 99, null, null);
  db.close();
} else if (mode === "inspect") {
  const db = new Database(path, { readonly: true });
  const count = (sql: string, cutoff: number) => db.query<{ n: number }, [number]>(sql).get(cutoff)?.n ?? -1;
  console.log(JSON.stringify({
    expiredRaw: count("SELECT count(*) n FROM utilization_samples WHERE ts<?", now - 14 * day),
    expiredHourly: count("SELECT count(*) n FROM utilization_hourly WHERE hour<?", now - 400 * day),
    hourly: count("SELECT count(*) n FROM utilization_hourly WHERE hour>=?", now - 2 * day),
    live: count("SELECT count(*) n FROM utilization_samples WHERE state='observed' AND cpuPct IS NOT NULL AND ts>=?", now - 5 * minute),
  }));
  db.close();
} else throw new Error("unknown fixture command");
