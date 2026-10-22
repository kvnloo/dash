import { renderToStaticMarkup } from "react-dom/server";
import { ThinkingSummaryChip } from "./ThinkingSummaryChip";
import type { SummaryInfo } from "../../../shared/thinking-summary";

const summary: SummaryInfo = { blockId: "turn", kind: "turn", text: "Checked demo branch; planned a fix.", model: "openai-codex/gpt-6-luna", durationMs: 3000 };
console.log(JSON.stringify({
  success: renderToStaticMarkup(<ThinkingSummaryChip turnId="synthetic" summary={summary} />),
  degraded: renderToStaticMarkup(<ThinkingSummaryChip turnId="synthetic" summary={{ ...summary, unavailable: "credential_unavailable", text: "Summary unavailable · @smol sign-in required" }} />),
}));
