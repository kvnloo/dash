/** Status-only projection shared by Hermes transports. Never inspect tool output for events. */
export class TurnPhase {
  private tools = new Map<string, string>();
  private sequence = 0;
  private previous?: string;
  private emit(text: string): void {
    if (text !== this.previous) { this.previous = text; this.status(text); }
  }
  constructor(private status: (text: string) => void) {}
  thinking(): void { this.emit(this.label() || "Thinking"); }
  text(): void { this.emit(this.label()); }
  start(name: string, id?: string): void {
    const key = id || `anonymous:${++this.sequence}`;
    this.tools.set(key, name === "tool" ? this.tools.get(key) ?? name : name);
    this.emit(this.label());
  }
  complete(id?: string, name?: string): void {
    const key = id || [...this.tools].find(([, tool]) => !name || tool === name)?.[0];
    if (key) this.tools.delete(key);
    this.emit(this.label() || "Thinking");
  }
  waiting(): void { this.emit("Waiting for approval or clarification"); }
  private label(): string {
    if ([...this.tools.values()].some(name => /^clarify$/i.test(name))) return "Waiting for clarification";
    return this.tools.size ? `Running ${[...this.tools.values()].join(", ")}` : "";
  }
}
