/** Pair-screen action availability and TalkBack state. No credentials leave this function. */
export type PairAction = "identity" | "tailscale" | "sound" | "code";

export type PairFormState = Readonly<{
  computer: string;
  bootstrapToken: string;
  identityLink: string;
  manualCode: string;
  busy: boolean;
  activeAction: PairAction | null;
}>;

export type PairActionState = Readonly<{
  disabled: boolean;
  busy: boolean;
}>;

export function pairActionState(action: PairAction, form: PairFormState): PairActionState {
  const hasAddress = form.computer.trim().length > 0;
  const hasToken = form.bootstrapToken.trim().length > 0;
  const readyForLegacyPair = hasAddress && hasToken;
  let available: boolean;

  switch (action) {
    case "identity":
      // Identity enrollment uses the supplied link, not a legacy bootstrap token.
      available = hasAddress && form.identityLink.trim().length > 0;
      break;
    case "code":
      // The text field normalizes typed codes; prefilled codes must also be valid.
      available = readyForLegacyPair && /^[A-Z0-9]{6}$/i.test(form.manualCode.trim());
      break;
    case "sound":
    case "tailscale":
      available = readyForLegacyPair;
      break;
  }

  return {
    disabled: form.busy || !available,
    // A different disabled action must not claim to be the one in progress.
    busy: form.busy && form.activeAction === action,
  };
}
