/** Composer placeholder copy. It must fit the one-line input beside the attach, voice and send
 *  controls on a 390-pt phone (about 24 characters of body text); the banner above the composer
 *  already explains a live CLI session, so the placeholder only names the action. */
export const COMPOSER_PLACEHOLDER_MAX = 24;

export function composerPlaceholder(state: {
  online: boolean;
  streaming: boolean;
  queued: number;
  openIn?: string;
  harnessName: string;
}): string {
  if (!state.online) return "Waiting for the bridge…";
  if (state.streaming) return state.queued > 0 ? `Queue another (${state.queued})…` : "Queue next message…";
  if (state.openIn) return "Queue a reply…";
  const full = `Message ${state.harnessName}`;
  return full.length <= COMPOSER_PLACEHOLDER_MAX ? full : "Message…";
}
