import type { SummaryInfo } from "../../shared/thinking-summary";
import { ThinkingSummarizer } from "./thinking-summary";

/** Host-side lifecycle adapter. Feed reasoning chunks and tool labels, never answer tokens. */
export class TurnSummaries {
  private text = "";
  private trace = "";
  private block = 0;
  private opened = 0;
  private started = 0;
  private closed = false;
  private pending: Promise<void>[] = [];
  constructor(private id: string, private summarizer: ThinkingSummarizer, private emit: (summary: SummaryInfo) => void, private now = Date.now) {}
  reasoning(delta: string): void {
    if (this.closed || !delta) return;
    if (!this.text) { this.block++; this.opened = this.now(); if (!this.started) this.started = this.opened; }
    this.text = (this.text + delta).slice(-12000);
    const block = this.block;
    const text = this.text;
    void this.summarizer.summarize({ chatId: this.id, blockId: String(block), text, kind: "live", enabled: true }).then(result => {
      if (result && !this.closed && this.block === block && this.text) this.emit({ blockId: String(block), kind: "live", text: result.text, model: result.model, durationMs: this.now() - this.opened });
    });
  }
  action(label: string): void {
    if (this.closed) return;
    this.endBlock();
    this.trace = `${this.trace}\nAction: ${label}`.slice(-12000);
  }
  endBlock(): void {
    if (!this.text) return;
    const text = this.text, blockId = String(this.block), durationMs = this.now() - this.opened;
    this.text = "";
    this.trace = `${this.trace}\nReasoning: ${text}`.slice(-12000);
    this.pending.push(this.summarizer.summarize({ chatId: this.id, blockId, text, kind: "final", enabled: true }).then(result => {
      if (result) this.emit({ blockId, kind: "final", text: result.text, model: result.model, durationMs });
    }));
  }
  async finish(): Promise<void> {
    if (this.closed) return;
    this.endBlock(); this.closed = true;
    await Promise.all(this.pending);
    if (!this.trace.trim()) return;
    const result = await this.summarizer.summarize({ chatId: this.id, blockId: "turn", text: this.trace, kind: "turn", enabled: true });
    if (result) this.emit({ blockId: "turn", kind: "turn", text: result.text, model: result.model, durationMs: this.started ? this.now() - this.started : 0 });
  }
}
