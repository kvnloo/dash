import { writeFileSync } from "node:fs";
import { readRecentModels } from "./bridge/src/recent-models-http";
const snapshot = readRecentModels("/workspace/hermes-home/profiles/chiefstaff", Date.now(), "local-8ccb1205e62ea34ed26ab12af0742bd603a634fac16ab578658430cff325174b");
writeFileSync("input-real-models.json", JSON.stringify({ ...snapshot, source: "Read-only chiefstaff state.db + provider_models_cache.json, captured on groot; no provider call", profile: "chiefstaff" }, null, 2));
console.log(JSON.stringify({ modelPairs: snapshot.models.length, catalogPairs: snapshot.catalog.length, currentObserved: snapshot.current !== null, truncated: snapshot.truncated, canApply: snapshot.canApply }));
