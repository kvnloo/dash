import type { Message } from "../model";
import type { DetailMode } from "./reply-details";
import type { Thinking } from "./thinking";
import { followsLatest } from "./prompt-navigation";

/** Complete inputs that can change a transcript row's visible content. */
export interface TranscriptRowProps {
  conversationId: string;
  message: Message;
  harnessId: string;
  detailMode: DetailMode;
  thinking?: Thinking;
}

/**
 * React.memo must not rely on id alone: an in-flight assistant retains its id
 * while its state, activity, and reply parts change. Stores publish immutable
 * snapshots. A cloned settled row with identical visible inputs can bail out.
 */
export function sameTranscriptMessage(a: Message, b: Message): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.role !== b.role || a.text !== b.text || a.at !== b.at) return false;
  if (a.role === "user") {
    if (b.role !== "user") return false;
    return a.attachments === b.attachments
      && a.delivery === b.delivery
      && a.deliveryAt === b.deliveryAt
      && a.deliveryNote === b.deliveryNote;
  }
  if (b.role !== "assistant") return false;
  return a.turnId === b.turnId
    && a.seq === b.seq
    && a.state === b.state
    && a.delivery === b.delivery
    && a.status === b.status
    && a.handoff === b.handoff
    && a.error === b.error
    && a.activity === b.activity
    && a.parts === b.parts
    && a.summaries === b.summaries;
}

/** This is the actual comparator passed to React.memo in TranscriptRows. */
export function sameTranscriptRowProps(a: TranscriptRowProps, b: TranscriptRowProps): boolean {
  const thinking = a.thinking === b.thinking
    || (a.thinking !== undefined && b.thinking !== undefined
      && a.thinking.phase === b.thinking.phase
      && a.thinking.tool === b.thinking.tool);
  return a.conversationId === b.conversationId
    && a.harnessId === b.harnessId
    && a.detailMode === b.detailMode
    && thinking
    && sameTranscriptMessage(a.message, b.message);
}

export interface TranscriptScrollMetrics {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
}

/**
 * The scrolling hot path owns no React state, timers, layout animation, or
 * rail-tick geometry. Only follow/unfollow *transitions* are published to React.
 * Native momentum remains observable after drag; programmatic jumps can call
 * stopDrag() before moving the list.
 */
export class TranscriptFollowGate {
  private previousOffset = 0;
  private dragging = false;
  private following: boolean;

  constructor(initialFollowing = true) {
    this.following = initialFollowing;
  }

  beginDrag(): void {
    this.dragging = true;
  }

  stopDrag(): void {
    this.dragging = false;
  }

  setFollowing(next: boolean): void {
    this.following = next;
  }

  reset(): void {
    this.previousOffset = 0;
    this.dragging = false;
    this.following = true;
  }

  observe(metrics: TranscriptScrollMetrics, webWheel = false): boolean | null {
    const { contentHeight, viewportHeight, offsetY } = metrics;
    if (!Number.isFinite(contentHeight) || !Number.isFinite(viewportHeight) || !Number.isFinite(offsetY)) return null;
    // A content resize must not detach following. Accumulate subpixel moves
    // rather than writing the baseline every frame.
    if (Math.abs(offsetY - this.previousOffset) <= 1) return null;
    this.previousOffset = offsetY;
    if (!this.dragging && !webWheel) return null;
    const next = followsLatest(contentHeight, viewportHeight, offsetY);
    if (next === this.following) return null;
    this.following = next;
    return next;
  }
}
