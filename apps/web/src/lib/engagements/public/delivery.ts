import 'server-only';
// Public (no-session) client delivery portal — the READ. Runs the SECURITY
// DEFINER token SDF on the base connection — NO withOrgContext, NO org GUCs, NO
// can(). The token IS the auth (mirrors lib/proposals/public.ts). The SDF
// physically omits every cost/margin/build-cost/token/internal column, so nothing
// here can leak the firm's cost. The raw token is never logged.
import { sql } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';
import { hashShareToken } from '@/lib/share/token';
import { KIND_CATEGORY } from '../portal-documents';
import { PORTAL_STAGE_LABEL, PORTAL_STAGE_NOTE } from '../portal-labels';
import { parseDocumentAccess } from '../document-access';
import { stateMilestone } from '../journey-map';
import { CLIENT_ACTION_VERBS, deriveHero } from '../portal-hero';
import type { DesignState } from '../states';
import {
  STATE_SET,
  isRenderableClaim,
  isRenderableDocument,
  isRenderableMilestone,
  type DeliverySnapshot,
} from './row-guards';
import type { PublicDelivery } from './types';

/**
 * Resolve a delivery by its RAW share token, or null. The token is sha256-hashed
 * here (never sent to the DB in the clear) and the SECURITY DEFINER SDF returns
 * null for an unknown / revoked / expired link. Maps the raw `state` to its
 * client-friendly bilingual label. Server-only; never logs the raw token.
 *
 * HARDENED (read-path defense): the SDF execute AND the entire snapshot →
 * PublicDelivery mapping run inside ONE try/catch. A VALID token can never 500 —
 * any throw (or any malformed field) logs a token-free breadcrumb and returns
 * null, which the page renders as the friendly not-found. Every dereferenced
 * field is null-safe so a missing `firm`/`client`, a non-array schedule, an
 * unknown verb, or a bad number degrades gracefully instead of crashing.
 */
export async function getDeliveryByToken(
  rawToken: string,
): Promise<PublicDelivery | null> {
  if (!rawToken || !rawToken.trim()) return null;
  const hash = hashShareToken(rawToken);

  // `hasSnapshot` distinguishes "the DB/SDF call itself threw" from "the mapping
  // of a returned snapshot threw" in the log breadcrumb — WITHOUT ever logging the
  // token or any client data.
  let hasSnapshot = false;
  try {
    const rows = (await withRequestDb((db) =>
      db.execute(sql`select public.app_delivery_by_token(${hash}) as data`),
    )) as unknown as Array<{ data: DeliverySnapshot | null }>;
    const snapshot = rows[0]?.data ?? null;
    if (!snapshot) return null;
    hasSnapshot = true;

    // The state comes from the DB enum, but if it is ever missing/unrecognised we
    // must NOT render a raw/unknown key to the client.
    if (!snapshot.state || !STATE_SET.has(snapshot.state)) return null;
    const state = snapshot.state as DesignState;

    // Identity: a usable delivery needs at least a valid id OR a finite number.
    // If BOTH are unusable the row is junk → not-found.
    const hasId = typeof snapshot.id === 'string' && snapshot.id.trim().length > 0;
    const numberIsFinite = Number.isFinite(snapshot.number);
    if (!hasId && !numberIsFinite) return null;
    const number = numberIsFinite ? (snapshot.number as number) : 0;

    // Null-safe object dereferences: a missing firm/client is common enough in a
    // malformed snapshot that it must degrade to null fields, not crash.
    const firm = snapshot.firm ?? ({} as NonNullable<DeliverySnapshot['firm']>);
    const client = snapshot.client ?? ({} as NonNullable<DeliverySnapshot['client']>);
    const rom = snapshot.rom;

    const paymentSchedule = Array.isArray(snapshot.payment_schedule)
      ? snapshot.payment_schedule.filter(isRenderableMilestone)
      : [];
    // Null-safe document mapping: a missing/non-array `documents` key (an older
    // SDF, a malformed snapshot) degrades to an EMPTY list — the portal then renders
    // its honest "nothing shared yet" empty state, never a crash.
    const documents = Array.isArray(snapshot.documents)
      ? snapshot.documents.filter(isRenderableDocument).map((row) => ({
          id: row.id,
          category: KIND_CATEGORY[row.kind],
          sharedAt: row.shared_at ?? null,
          // A count, never a body — the thread itself is a separate, lazy fetch.
          // Non-numeric / negative jsonb degrades to 0 rather than rendering junk.
          commentCount:
            typeof row.comment_count === 'number' && row.comment_count > 0
              ? Math.floor(row.comment_count)
              : 0,
          // Junk parses to `withheld`, never to `download`.
          access: parseDocumentAccess(row.access),
        }))
      : [];
    const clientActions = Array.isArray(snapshot.client_actions)
      ? snapshot.client_actions.filter(
          (verb): verb is string =>
            typeof verb === 'string' && CLIENT_ACTION_VERBS.has(verb),
        )
      : [];

    // Null-safe claim mapping: a missing/non-array claim object degrades to null
    // (the portal renders no claim surface), never a crash.
    const rawClaims = snapshot.claim?.claimable_milestones;
    const paymentClaim = Array.isArray(rawClaims)
      ? {
          claimableMilestones: rawClaims.filter(isRenderableClaim).map((row) => ({
            milestoneKind: row.milestone_kind,
            amountRemaining: row.amount_remaining,
            hasPendingClaim: row.has_pending_claim === true,
          })),
        }
      : null;

    return {
      id: hasId ? (snapshot.id as string) : '',
      number,
      stageLabel: PORTAL_STAGE_LABEL[state],
      stageNote: PORTAL_STAGE_NOTE[state],
      milestone: stateMilestone(state),
      hero: deriveHero(clientActions, state),
      offPlan: snapshot.off_plan === true,
      titleAr: snapshot.title_ar ?? null,
      titleEn: snapshot.title_en ?? null,
      createdAt: snapshot.created_at ?? null,
      designFeeTotal: snapshot.design_fee_total ?? null,
      rom: rom ? { low: rom.low ?? null, high: rom.high ?? null } : null,
      shareExpiresAt: snapshot.share_expires_at ?? null,
      firm: {
        nameAr: firm.name_ar ?? null,
        nameEn: firm.name_en ?? null,
        logoFileId: firm.logo_file_id ?? null,
      },
      client: {
        nameAr: client.name_ar ?? null,
        nameEn: client.name_en ?? null,
      },
      paymentSchedule,
      paymentClaim,
      documents,
      clientActions,
    };
  } catch {
    // Token-free breadcrumb only — never the raw token or any client data.
    console.error('delivery read failed', { hasSnapshot });
    return null;
  }
}
