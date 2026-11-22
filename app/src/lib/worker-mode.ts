import type { NoticeMode } from "../../../shared/protocol";

export function nativeNoticeMode(): NoticeMode | undefined { return undefined; }
export function subscribeToWorkerMode(_changed: () => void): () => void { return () => {}; }
