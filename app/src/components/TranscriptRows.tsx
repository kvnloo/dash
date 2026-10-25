import { memo, useCallback, type ReactElement } from "react";
import type { Message } from "../model";
import type { DetailMode } from "../lib/reply-details";
import type { Thinking } from "../lib/thinking";
import { sameTranscriptRowProps, type TranscriptRowProps } from "../lib/transcript-scroll-performance";
import { MessageRow } from "./MessageRow";

/**
 * FlashList recycles cells. Keep the row's identity (conversation + message id)
 * in its memo contract, but never conceal an actual same-id edit or status
 * update. MessageRow keeps its own keyed live-text subscription.
 */
export const TranscriptRow = memo(function TranscriptRow(props: TranscriptRowProps) {
  const { message, harnessId, detailMode, thinking } = props;
  return <MessageRow
    message={message}
    harnessId={harnessId}
    detailMode={detailMode}
    thinking={thinking}
  />;
}, sameTranscriptRowProps);

export interface TranscriptRenderOptions {
  conversationId: string;
  harnessId: string;
  detailMode: DetailMode;
  latestAssistantId?: string;
  thinking?: Thinking;
}

/**
 * A scroll/follow state transition must not create a new FlashList renderItem
 * callback. Only real row input changes replace it. Updates to the active
 * assistant can still invalidate the list; settled rows bail in TranscriptRow.
 */
export function useTranscriptRenderItem({
  conversationId,
  harnessId,
  detailMode,
  latestAssistantId,
  thinking,
}: TranscriptRenderOptions): ({ item }: { item: Message }) => ReactElement {
  return useCallback(({ item }: { item: Message }) => (
    <TranscriptRow
      conversationId={conversationId}
      message={item}
      harnessId={harnessId}
      detailMode={detailMode}
      thinking={item.id === latestAssistantId ? thinking : undefined}
    />
  ), [conversationId, harnessId, detailMode, latestAssistantId, thinking]);
}
