export type AttachmentNoticeRequest =
  | { kind: "pair-required" }
  | { kind: "limit-reached"; limit: number }
  | { kind: "picker-error"; message: string }
  | { kind: "shared-upload"; count: number };

export type AttachmentNoticeAction = "dismiss" | "confirm-upload";

export interface AttachmentNoticeButton {
  label: string;
  action: AttachmentNoticeAction;
}

export interface AttachmentNoticeView {
  title: string;
  detail: string;
  primary: AttachmentNoticeButton;
  secondary: AttachmentNoticeButton | null;
}

function acknowledgement(title: string, detail: string): AttachmentNoticeView {
  return { title, detail, primary: { label: "OK", action: "dismiss" }, secondary: null };
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** System picker errors can be empty or unwieldy; never show an empty alert. */
export function pickerErrorDetail(message: string): string {
  const collapsed = message.replace(/\s+/g, " ").trim();
  if (!collapsed) return "Could not open the picker. Try again.";
  const chars = Array.from(collapsed);
  return chars.slice(0, 240).join("") + (chars.length > 240 ? "…" : "");
}

/** A Dash-owned presentation for attachment prompts formerly shown via Alert.alert. */
export function attachmentNoticeView(request: AttachmentNoticeRequest): AttachmentNoticeView {
  switch (request.kind) {
    case "pair-required":
      return acknowledgement("Pair first", "Pair with a computer before adding attachments.");
    case "limit-reached":
      if (!positiveInteger(request.limit)) {
        return acknowledgement("Attachment limit reached", "This draft cannot accept more attachments.");
      }
      return acknowledgement(
        "Attachment limit reached",
        "Up to " + request.limit + (request.limit === 1 ? " file" : " files") + " per message. Remove an attachment to add another.",
      );
    case "picker-error":
      return acknowledgement("Could not open attachments", pickerErrorDetail(request.message));
    case "shared-upload":
      if (!positiveInteger(request.count)) {
        return acknowledgement("No shared files", "There are no shared files waiting to upload.");
      }
      return {
        title: "Upload shared files?",
        detail: "Upload " + (request.count === 1 ? "this file" : "these " + request.count + " files") +
          " to your paired computer over Tailscale. This does not send a message to an agent.",
        primary: { label: "Upload files", action: "confirm-upload" },
        secondary: { label: "Cancel", action: "dismiss" },
      };
  }
}

export interface AttachmentNoticeHandlers {
  onDismiss(): void;
  onConfirmUpload(): void;
}

/**
 * One prompt may settle only once. Android Back, backdrop, Cancel and repeated
 * presses all share this gate; confirmation is valid only for nonempty consent.
 */
export function createAttachmentNoticeController(
  request: AttachmentNoticeRequest,
  handlers: AttachmentNoticeHandlers,
): (action: AttachmentNoticeAction) => boolean {
  let settled = false;
  return action => {
    if (settled) return false;
    if (action === "confirm-upload" && (request.kind !== "shared-upload" || !positiveInteger(request.count))) {
      return false;
    }
    settled = true;
    handlers.onDismiss();
    if (action === "confirm-upload") handlers.onConfirmUpload();
    return true;
  };
}
