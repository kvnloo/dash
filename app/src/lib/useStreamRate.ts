import { useEffect, useRef, useState } from "react";
import { replyText } from "../store/text";
import { createStreamRate, formatStreamRate, type StreamRateSampler } from "./stream-rate";

const MIN_RATE_AGE_MS = 1_200;
const RATE_PAINT_MS = 250;
const POST_TURN_MS = 5_000;

interface ActiveRate {
  conversationId: string;
  sampler: StreamRateSampler;
  previousChars: number;
  startedAt: number;
  lastPaintAt: number;
  lastLabel: string | null;
}

/**
 * Observe the real streamed reply, not the conversation store: text is updated
 * per reply on animation frames. The bridge has no output-token counter on its
 * TurnEvent wire yet, so the shared estimator labels character rates as approximate.
 */
export function useStreamRate(conversationId?: string, turnId?: string): {
  rateLabel: string | null;
  recent: boolean;
} {
  const [rateLabel, setRateLabel] = useState<string | null>(null);
  const [recent, setRecent] = useState(false);
  const active = useRef<ActiveRate | null>(null);

  useEffect(() => {
    if (!turnId || !conversationId) {
      const completed = active.current;
      if (!completed || completed.conversationId !== conversationId) {
        active.current = null;
        setRateLabel(null);
        setRecent(false);
        return;
      }

      completed.sampler.finish();
      setRateLabel(formatStreamRate(completed.sampler.rate()) ?? completed.lastLabel);
      setRecent(true);
      const timeout = setTimeout(() => {
        if (active.current !== completed) return;
        active.current = null;
        setRateLabel(null);
        setRecent(false);
      }, POST_TURN_MS);
      return () => clearTimeout(timeout);
    }

    const next: ActiveRate = {
      conversationId,
      sampler: createStreamRate({ now: Date.now }),
      previousChars: 0,
      startedAt: Date.now(),
      lastPaintAt: 0,
      lastLabel: null,
    };
    active.current = next;
    setRateLabel(null);
    setRecent(false);

    const sample = () => {
      const chars = replyText.get(turnId).length;
      if (chars > next.previousChars) next.sampler.sample(Date.now(), chars - next.previousChars);
      next.previousChars = Math.max(next.previousChars, chars);

      const now = Date.now();
      if (now - next.startedAt < MIN_RATE_AGE_MS || now - next.lastPaintAt < RATE_PAINT_MS) return;
      const formatted = formatStreamRate(next.sampler.rate(now));
      if (formatted && formatted !== next.lastLabel) {
        next.lastLabel = formatted;
        next.lastPaintAt = now;
        setRateLabel(formatted);
      }
    };
    const unsubscribe = replyText.subscribe(turnId, sample);
    sample();
    return unsubscribe;
  }, [conversationId, turnId]);

  return { rateLabel, recent };
}
