/**
 * The ONE transactional-email shell: page, card, wordmark, optional heading,
 * body, one CTA button, optional "the button didn't work" fallback.
 *
 * There were three of these — one inlined in the invite template, one in the
 * proposal-sent template, one a private `shell()` in the automation templates —
 * and they had already drifted: two escaped the href and one escaped the CTA
 * label, so which characters were safe in an email depended on which email it
 * was. Drift in a shell is not cosmetic: the href is the only place in these
 * documents where a caller-supplied value meets a quoted attribute.
 *
 * WHAT IS ESCAPED HERE and what is not, stated once so no caller has to guess:
 *  - `heading` is escaped here.
 *  - `bodyHtml` is MARKUP and arrives pre-escaped — it is where a template puts
 *    its own paragraphs, so it cannot be escaped without destroying them.
 *  - `cta.url` is escaped here, in both places it appears.
 *  - `cta.label` arrives pre-escaped, because today's labels are fixed literals
 *    and one of them ("View & respond to the quote") carries a bare ampersand
 *    that the proposal template has always emitted raw. Escaping it here would
 *    silently change a shipped email; a caller that ever passes user text must
 *    escape it itself.
 */
import { EMAIL_BRAND, emailWordmark } from '@/lib/email/brand';
import { escapeHtml } from '@/lib/html/escape';

export interface EmailShellInput {
  dir: 'rtl' | 'ltr';
  /** Bold lead line. Escaped here. Omitted entirely when absent. */
  heading?: string;
  /** The template's own paragraphs, PRE-ESCAPED. */
  bodyHtml: string;
  /** `label` is pre-escaped; `url` is escaped here. */
  cta: { label: string; url: string };
  /** When present, adds the fallback sentence AND the visible link beneath it. */
  fallbackNote?: string;
}

export function emailShell(input: EmailShellInput): string {
  const { dir, heading, bodyHtml, cta, fallbackNote } = input;
  const headingHtml =
    heading === undefined
      ? ''
      : `    <p style="color:${EMAIL_BRAND.text};font-weight:600;">${escapeHtml(heading)}</p>\n`;
  const fallbackHtml =
    fallbackNote === undefined ? '' : fallbackBlock(fallbackNote, cta.url);

  return `<!doctype html><html dir="${dir}"><body style="font-family:system-ui,-apple-system,sans-serif;background:${EMAIL_BRAND.page};padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:${EMAIL_BRAND.card};border-radius:16px;padding:32px;">
    <h1 style="font-size:20px;margin:0 0 8px;">${emailWordmark(dir)}</h1>
${headingHtml}${bodyHtml}
    <p style="margin:24px 0;">
      <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${EMAIL_BRAND.brand};color:${EMAIL_BRAND.onBrand};text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">${cta.label}</a>
    </p>
${fallbackHtml}  </div></body></html>`;
}

/** The note plus the URL spelled out, for the mail clients that strip buttons. */
function fallbackBlock(note: string, url: string): string {
  return (
    `    <p style="color:${EMAIL_BRAND.muted};font-size:13px;">${note}</p>\n` +
    `    <p style="word-break:break-all;font-size:13px;"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>\n`
  );
}
