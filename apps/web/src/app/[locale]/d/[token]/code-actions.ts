'use server';

import { CODE_PURPOSES, LINK_BRAKE_REFUSAL, type CodePurpose, type CodeRequestAnswer } from '@/lib/client-home/code-answers';
import {
  alertPlatformCodesHalfUsed,
  logCodeNotSent,
  logCodeRequestRefused,
  logCodeUnsentNotMarked,
} from '@/lib/client-home/code-log';
import { issueClientCodeByToken, markClientCodeUnsentByToken, newClientCode, type CodeIssueResult } from '@/lib/client-home/codes';
import { homeCodeActHref } from '@/lib/client-home/tab';
import { claimableMilestoneOf } from '@/lib/engagements/claimable-milestones';
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
// address on file, with a link that opens the act on its code box. The browser
// is told only where it went (the masked hint), never the address, the
// studio's own words, the code or its row.
//
// THE PER-LINK BRAKE comes first (lib/share/portal-rate-limit.ts, the act
// budget). NOTHING THROWS TO THE CLIENT: a failure underneath is `uncertain`
// (the row may exist, nothing was sent) or `generic` with its reference.

const failed = (failure: PortalFailure) => ({ ok: false as const, ...failure });

/** The act's target as the database keys it (a request's or a contract's id lower-cased, a milestone kind), or null when it cannot name one. */
function targetOf(purpose: CodePurpose, target: unknown): string | null {
  if (purpose === 'claim_design_payment') return claimableMilestoneOf(target);
  return isUuid(target) ? target.toLowerCase() : null;
}

/** The client's page the email links back to: the act itself, open on its code box (H5 functional F1). */
function actUrlOf(origin: string, locale: string, rawToken: string, act: { purpose: CodePurpose; target: string }): string {
  return `${origin}/${locale}${homeCodeActHref(tokenPathSegment(rawToken), act)}`;
}

/**
 * Email the code the database accepted, in the page's language. When it did
 * not leave: one log line with what the provider said, and the code is marked
 * unsent, so it spends no day limit (H5 reliability R1); false.
 */
async function emailCode(
  issued: Extract<CodeIssueResult, { status: 'ok' }>,
  code: string,
  act: { purpose: CodePurpose; target: string },
  link: { origin: string; rawToken: string },
): Promise<boolean> {
  const locale = await requestLocaleOrDefault();
  const sent = await sendClientCodeEmail({
    to: issued.email,
    code,
    purpose: act.purpose,
    documentNumber: issued.documentNumber,
    studioName: pickLocale(issued.studio, 'name', locale).value,
    homeUrl: actUrlOf(link.origin, locale, link.rawToken, act),
    locale,
  });
  if (sent.sent) return true;
  logCodeNotSent(act.purpose, { transient: sent.transient === true, refusal: sent.refusal });
  await markUnsent(link.rawToken, issued.challengeId, act.purpose);
  return false;
}

/** Mark a code whose email failed as unsent; a mark that did not land is logged, never thrown (the client is told send_failed either way). */
async function markUnsent(rawToken: string, challengeId: string, purpose: CodePurpose): Promise<void> {
  try {
    const marked = await markClientCodeUnsentByToken(rawToken, challengeId);
    if (marked !== 'ok') logCodeUnsentNotMarked(purpose, marked);
  } catch {
    logCodeUnsentNotMarked(purpose, 'failed');
  }
}

/**
 * Public (no-session): email the client a one-time code for ONE act on their
 * home. `purpose` and `target` name the act (a payment request's id, a
 * design-fee milestone kind, or the execution contract's id for signing it);
 * a code is good for that act only, for ten
 * minutes and five tries, and only the newest one works. A client with no
 * address on file is `no_channel`; an act that cannot be taken now is
 * `not_available`; either way nothing is written or sent. `send_failed` is
 * honest: the code was made but did not leave, and the client is told to
 * contact the studio and when a new one may be asked for.
 */
export async function requestClientCode(
  token: string,
  input: { purpose: CodePurpose; target: string },
): Promise<CodeRequestAnswer> {
  return answered('requestClientCode', failed, async (): Promise<CodeRequestAnswer> => {
    const purpose = CODE_PURPOSES.find((known) => known === input?.purpose);
    const target = purpose ? targetOf(purpose, input.target) : null;
    if (!purpose || target === null) return { ok: false, error: 'not_available' };
    if (!(await portalActAllowed(token))) return LINK_BRAKE_REFUSAL;
    // The email's link needs the public origin; without it nothing is written.
    const origin = await resolveRequestOrigin();
    if (!origin) {
      console.error('client code request: no public origin to link the email to');
      return { ok: false, error: 'send_failed', resendAfterSeconds: null };
    }
    const fresh = newClientCode(purpose, target);
    const issued = await issueClientCodeByToken(token, { codeHash: fresh.codeHash, purpose, target, ...(await requestProvenance()) });
    switch (issued.status) {
      case 'ok':
        if (issued.platformDayHalfCrossed) alertPlatformCodesHalfUsed(purpose);
        if (!(await emailCode(issued, fresh.code, { purpose, target }, { origin, rawToken: token.trim() }))) {
          return { ok: false, error: 'send_failed', resendAfterSeconds: issued.resendAfterSeconds };
        }
        return { ok: true, hint: issued.hint, resendAfterSeconds: issued.resendAfterSeconds };
      case 'too_many':
        logCodeRequestRefused(purpose, { kind: 'too_many', limit: issued.limit, retryAfterSeconds: issued.retryAfterSeconds });
        return { ok: false, error: 'too_many', retryAfterSeconds: issued.retryAfterSeconds, limit: issued.limit };
      case 'busy':
        logCodeRequestRefused(purpose, { kind: 'busy' });
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
