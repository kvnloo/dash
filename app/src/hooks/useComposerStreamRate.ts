import { useEffect, useRef, useState } from "react";
import { createStreamRate, formatStreamRate, type StreamRateSampler } from "../lib/stream-rate";
import { replyText } from "../store/text";

type Reading = { turnId: string; sampler: StreamRateSampler; length: number };
type Display = { turnId: string; label: string | null; recent: boolean };
const EMPTY: Display = { turnId: "", label: null, recent: false };

/**
 * Sample only the attached reply's actual text stream, not thinking/tool activity.
 * replyText notifications are frame-coalesced; no per-token writes touch chats.
 * Character-derived rates are explicitly estimated, never called host measurements.
 */
export function useComposerStreamRate(turnId: string | undefined, streaming: boolean) {
  const active = useRef(streaming);
  active.current = streaming;
  const reading = useRef<Reading | null>(null);
  const [display, setDisplay] = useState<Display>(EMPTY);

  useEffect(() => {
    reading.current = null;
    setDisplay(EMPTY);
    if (!turnId) return;
    const sample: Reading = {
      turnId,
      sampler: createStreamRate({ now: () => performance.now() }),
      length: replyText.get(turnId).length,
    };
    reading.current = sample;
    const refresh = () => {
      if (!active.current || reading.current !== sample) return;
      const at = performance.now();
      const length = replyText.get(turnId).length;
      if (length > sample.length) sample.sampler.sample(at, length - sample.length);
      sample.length = length;
      const label = formatStreamRate(sample.sampler.rate(at));
      setDisplay(previous =>
        previous.turnId === turnId && previous.label === label && !previous.recent
          ? previous : { turnId, label, recent: false },
      );
    };
    const unsubscribe = replyText.subscribe(turnId, refresh);
    const clock = setInterval(refresh, 250);
    refresh();
    return () => {
      unsubscribe();
      clearInterval(clock);
      if (reading.current === sample) reading.current = null;
    };
  }, [turnId]);

  useEffect(() => {
    if (streaming || !turnId) return;
    const sample = reading.current;
    if (!sample || sample.turnId !== turnId) return;
    const at = performance.now();
    sample.sampler.finish(at);
    const label = formatStreamRate(sample.sampler.rate(at));
    setDisplay({ turnId, label, recent: label !== null });
    const timeout = setTimeout(() => setDisplay(previous => previous.turnId === turnId ? EMPTY : previous), 5_000);
    return () => clearTimeout(timeout);
  }, [streaming, turnId]);

  return {
    rateLabel: display.turnId === turnId ? display.label : null,
    rateRecent: display.turnId === turnId && display.recent,
  };
}
