import type { IncomingShare } from "./incoming-share";
export async function consumeNativeShare(): Promise<IncomingShare | null> { return null; }
export async function discardNativeShare(_id: string): Promise<void> {}
