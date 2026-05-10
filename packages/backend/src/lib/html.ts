import type { PixelTokenPayload, RecipientInput } from "../types.js";
import { signPixelToken } from "./token.js";

export function instrumentHtmlBody(
  htmlBody: string,
  recipients: RecipientInput[],
  payloads: PixelTokenPayload[],
  appBaseUrl: string,
  secret: string,
): { html: string; warning: string | null } {
  const pixels = payloads
    .map((payload) => {
      const signed = signPixelToken(payload, secret);
      return `<img src="${appBaseUrl}/t/${encodeURIComponent(signed)}.gif" alt="" width="1" height="1" style="width:1px!important;height:1px!important;opacity:0!important;border:0;outline:none;text-decoration:none;" />`;
    })
    .join("");

  const warning = recipients.length > 1
    ? "Multi-recipient attribution is limited in Gmail because all recipients receive the same HTML body."
    : null;

  return {
    html: `${htmlBody}${pixels}`,
    warning,
  };
}
