import { MODEL_UNKNOWN } from "./chat-window";

export interface ModelChipLabel {
  /** Shortened display text. Never longer than 18 characters. */
  short: string;
  /** Cleaned model name, preserved for screen readers. */
  full: string;
}

export interface ComposerChipsInput {
  /** Host-reported model for this session, not an inferred default. */
  model?: string;
  provider?: string;
  /** Output of formatStreamRate; null when the rate is unavailable. */
  rateLabel?: string | null;
  streaming: boolean;
  /** Caller owns the five-second post-stream visibility window. */
  recent?: boolean;
}

export interface ChipModel {
  id: "model" | "rate";
  label: string;
  accessibilityLabel: string;
}

const MODEL_LIMIT = 18;
const TRAILING_QUALIFIER = /(?:-latest|-(?:19|20)\d{2}(?:-?\d{2}){2}|@(?:19|20)\d{2}-\d{2}-\d{2})$/i;
const UNKNOWN_MODEL = /^(?:unknown|unavailable|n\/a|none|null|undefined|[-—])$/i;

function shortenMiddle(value: string): string {
  if (value.length <= MODEL_LIMIT) return value;
  const front = Math.ceil((MODEL_LIMIT - 1) / 2);
  const back = MODEL_LIMIT - front - 1;
  return value.slice(0, front) + "…" + value.slice(-back);
}

/** A provider prefix and release-date aliases are not the model's identity. */
export function modelChipLabel(model?: string, provider?: string): ModelChipLabel | null {
  let full = model?.trim() ?? "";
  if (!full) return null;

  const explicitProvider = provider?.trim();
  if (explicitProvider && full.toLowerCase().startsWith(explicitProvider.toLowerCase() + "/")) {
    full = full.slice(explicitProvider.length + 1);
  } else {
    // Also handle the usual provider/model format when no provider field is supplied.
    full = full.replace(/^[^/\s]+\//, "");
  }

  while (TRAILING_QUALIFIER.test(full)) {
    full = full.replace(TRAILING_QUALIFIER, "").trim();
  }
  full = full.trim();
  if (!full || full.toLowerCase() === MODEL_UNKNOWN.toLowerCase() || UNKNOWN_MODEL.test(full)) return null;

  return { short: shortenMiddle(full), full };
}

/**
 * Pure presentation mapping; samples/timers are owned by the stream-rate caller.
 * Only the sibling formatter's numeric "tok/s" labels can become speed chips.
 */
export function composerChips({ model, provider, rateLabel, streaming, recent = false }: ComposerChipsInput): ChipModel[] {
  const chips: ChipModel[] = [];
  const namedModel = modelChipLabel(model, provider);
  if (namedModel) {
    chips.push({
      id: "model",
      label: namedModel.short,
      accessibilityLabel: "Model: " + namedModel.full,
    });
  }

  if (streaming || recent) {
    const label = rateLabel?.trim() ?? "";
    const match = /^(≈\s*)?(\d+(?:\.\d+)?)\s*tok\/s$/i.exec(label);
    const quantity = match?.[2];
    if (match && quantity) {
      chips.push({
        id: "rate",
        label,
        accessibilityLabel: "Speed: " + quantity + " tokens per second" + (match[1] ? ", estimated" : ""),
      });
    }
  }

  return chips;
}
