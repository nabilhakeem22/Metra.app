'use server';

import { CODE_PURPOSES, type CodePurpose, type CodeRequestAnswer } from '@/lib/client-home/code-answers';
import { alertPlatformCodesHalfUsed, logCodeNotSent, logCodeRequestRefused } from '@/lib/client-home/code-log';
import { issueClientCodeByToken, newClientCode, type CodeIssueResult } from '@/lib/client-home/codes';
import { homeHref } from '@/lib/client-home/tab';
import { sendClientCodeEmail } from '@/lib/email/client-code';
import { tokenPathSegment } from '@/lib/engagements/portal-path';
import { requestLocaleOrDefault } from '@/lib/engagements/portal-url';
import { resolveRequestOrigin } from '@/lib/http/request-origin';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
import { portalActAllowed } from '@/lib/share/portal-rate-limit';
import { requestProvenance } from '@/lib/share/request-provenance';
import { isUuid } from '@/lib/uuid';

// The client home's one-time code: the client asks, the server makes the code,
// the database checks the act can be taken now and every limit and keeps the
// code's hash (ONE token function), and the code is emailed to the client's
// address on file. The browser is told only where it went (the masked hint),
// never the address, the studio's own words or the code.
//
// THE PER-LINK BRAKE comes first (lib/share/portal-rate-limit.ts, the act
// budget). NOTHING THROWS TO THE CLIENT: a failure underneath is `uncertain`
// (the row may exist, nothing was sent) or `generic` with its reference.

const failed = (failure: PortalFailure) => ({ ok: false as const, ...failure });

/** The per-link brake is per minute: ask again after one. */
const LINK_BRAKE_SECONDS = 60;

/** The act's target as the database keys it, or null when it cannot name one. */
function targetOf(purpose: CodePurpose, target: unknown): string | null {
  if (purpose === 'claim_request') return isUuid(target) ? target.toLowerCase() : null;
  return typeof target === 'string' && target.length > 0 && target.length <= 64 ? target : null;
}

/** The client's page the email links back to: the tab the act is on. */
function homeUrlOf(origin: string, locale: string, rawToken: string, purpose: CodePurpose): string {
  const tab = purpose === 'claim_request' ? 'execution' : null;
  return `${origin}/${locale}${homeHref(tokenPathSegment(rawToken), tab)}`;
}

/** Email the code the database accepted, in the page's language; false (and one log line) when it did not leave. */
async function emailCode(
  issued: Extract<CodeIssueResult, { status: 'ok' }>,
  code: string,
  purpose: CodePurpose,
  link: { origin: string; rawToken: string },
): Promise<boolean> {
  const locale = await requestLocaleOrDefault();
  const sent = await sendClientCodeEmail({
    to: issued.email,
    code,
    purpose,
    documentNumber: issued.documentNumber,
    studioName: pickLocale(issued.studio, 'name', locale).value,
    homeUrl: homeUrlOf(link.origin, locale, link.rawToken, purpose),
    locale,
  });
  if (!sent.sent) logCodeNotSent(purpose, sent.transient === true);
  return sent.sent;
}

/**
 * Public (no-session): email the client a one-time code for ONE act on their
 * home. `purpose` and `target` name the act (a payment request's id, or a
 * design-fee milestone kind); a code is good for that act only, for ten
 * minutes and five tries. A client with no address on file is `no_channel`;
 * an act that cannot be taken now is `not_available`; either way nothing is
 * written or sent. `send_failed` is honest: the code was made but did not
 * leave, and the client is told to contact the studio.
 */
export async function requestClientCode(
  token: string,
  input: { purpose: CodePurpose; target: string },
): Promise<CodeRequestAnswer> {
  return answered('requestClientCode', failed, async (): Promise<CodeRequestAnswer> => {
    const purpose = CODE_PURPOSES.find((known) => known === input?.purpose);
    const target = purpose ? targetOf(purpose, input.target) : null;
    if (!purpose || target === null) return { ok: false, error: 'not_available' };
    if (!(await portalActAllowed(token))) return { ok: false, error: 'too_many', retryAfterSeconds: LINK_BRAKE_SECONDS };
    // The email's link needs the public origin; without it nothing is written.
    const origin = await resolveRequestOrigin();
    if (!origin) {
      console.error('client code request: no public origin to link the email to');
      return { ok: false, error: 'send_failed' };
    }
    const code = newClientCode();
    const issued = await issueClientCodeByToken(token, { code, purpose, target, ...(await requestProvenance()) });
    switch (issued.status) {
      case 'ok':
        if (issued.platformDayHalf) alertPlatformCodesHalfUsed(purpose);
        if (!(await emailCode(issued, code.code, purpose, { origin, rawToken: token.trim() }))) return { ok: false, error: 'send_failed' };
        return { ok: true, challengeId: code.challengeId, hint: issued.hint, resendAfterSeconds: issued.resendAfterSeconds };
      case 'too_many':
        logCodeRequestRefused(purpose, 'too_many', issued.retryAfterSeconds);
        return { ok: false, error: 'too_many', retryAfterSeconds: issued.retryAfterSeconds };
      case 'busy':
        logCodeRequestRefused(purpose, 'busy');
        return { ok: false, error: 'busy' };
      case 'invalid':
        return { ok: false, error: 'token_invalid' };
      case 'expired':
        return { ok: false, error: 'token_expired' };
      default:
        return { ok: false, error: issued.status };
    }
  });
}
