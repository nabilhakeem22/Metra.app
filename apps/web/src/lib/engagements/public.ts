import 'server-only';
// Public (no-session) client delivery portal. Runs the SECURITY DEFINER token SDF
// on the base connection — NO withOrgContext, NO org GUCs, NO can(). The token IS
// the auth (mirrors lib/proposals/public.ts). The SDF physically omits every
// cost/margin/build-cost/token/internal column, so nothing here can leak the
// firm's cost. The raw token is never logged.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';
import {
  PORTAL_STAGE_LABEL,
  PORTAL_STAGE_NOTE,
  type PortalLabel,
} from './portal-labels';
import { stateMilestone, type MilestoneProgress } from './journey-map';
import {
  CLIENT_ACTION_VERBS,
  deriveHero,
  type HeroView,
} from './portal-hero';
import { DESIGN_STATES, type DesignState } from './states';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** One milestone in the client's payment schedule — DUE amounts only, no cost. */
export interface PublicDeliveryMilestone {
  milestone_kind: string;
  basis: string;
  amount_due: string;
  amount_cleared: string;
  status: 'paid' | 'partial' | 'due';
}

/** The firm-branded, cost-stripped snapshot the portal renders. */
export interface PublicDelivery {
  id: string;
  number: number;
  /** Client-friendly, bilingual stage label (mapped from `state` server-side).
   *  The raw machine state is deliberately NOT part of this client-facing shape,
   *  so it never reaches the browser payload. */
  stageLabel: PortalLabel;
  /** Read-only "what's happening / what's next" line, bilingual. */
  stageNote: PortalLabel;
  /** The client's position on the 5-milestone journey. Derived server-side from
   *  the raw state so the machine state name never reaches the browser payload. */
  milestone: MilestoneProgress;
  /** The single "what needs you now" hero. Derived server-side (no raw state). */
  hero: HeroView;
  offPlan: boolean;
  titleAr: string | null;
  titleEn: string | null;
  createdAt: string | null;
  /** The design fee the CLIENT pays (scale-4 string), or null before it is set. */
  designFeeTotal: string | null;
  /** The client-acknowledged budget band (scale-4 strings), or null if unset. */
  rom: { low: string | null; high: string | null } | null;
  shareExpiresAt: string | null;
  firm: { nameAr: string | null; nameEn: string | null; logoFileId: string | null };
  client: { nameAr: string | null; nameEn: string | null };
  paymentSchedule: PublicDeliveryMilestone[];
  /** Client-facing verb tokens the client MAY act on right now (approve_concept,
   *  request_concept_changes, approve_design, request_design_changes,
   *  acknowledge_rom, acknowledge_handoff). Server-computed by the SDF; NEVER a raw
   *  machine state name. Empty when nothing is actionable / already confirmed. */
  clientActions: string[];
}

/**
 * The raw jsonb shape the SDF returns (snake_case, matches app_delivery_by_token).
 * Typed as UNTRUSTED: every field is optional/nullable because this is external
 * jsonb — the read path treats a missing/wrong-typed field as absent and degrades
 * to null rather than trusting the shape. `getDeliveryByToken` is the sole guard
 * that turns this into the strict, client-safe `PublicDelivery`.
 */
interface DeliverySnapshot {
  id?: string | null;
  number?: number | null;
  state?: string | null;
  off_plan?: boolean | null;
  title_ar?: string | null;
  title_en?: string | null;
  created_at?: string | null;
  design_fee_total?: string | null;
  rom?: { low?: string | null; high?: string | null } | null;
  share_expires_at?: string | null;
  firm?: { name_ar?: string | null; name_en?: string | null; logo_file_id?: string | null } | null;
  client?: { name_ar?: string | null; name_en?: string | null } | null;
  payment_schedule?: PublicDeliveryMilestone[] | null;
  client_actions?: string[] | null;
}

const STATE_SET = new Set<string>(DESIGN_STATES);

/** The four money statuses the portal knows how to render. */
const MILESTONE_STATUSES = new Set<string>(['paid', 'partial', 'due']);

/**
 * A schedule row is renderable only when it carries the three fields the portal
 * dereferences: a non-empty `milestone_kind`, a known `status`, and an
 * `amount_due`. Anything else (a null hole, a stray shape, an unknown status) is
 * dropped — never rendered — so a malformed row can neither crash nor mislead.
 */
function isRenderableMilestone(row: unknown): row is PublicDeliveryMilestone {
  if (!row || typeof row !== 'object') return false;
  const candidate = row as Record<string, unknown>;
  return (
    typeof candidate.milestone_kind === 'string' &&
    candidate.milestone_kind.length > 0 &&
    typeof candidate.status === 'string' &&
    MILESTONE_STATUSES.has(candidate.status) &&
    candidate.amount_due != null
  );
}

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
  const hash = hashToken(rawToken.trim());

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
    const clientActions = Array.isArray(snapshot.client_actions)
      ? snapshot.client_actions.filter(
          (verb): verb is string =>
            typeof verb === 'string' && CLIENT_ACTION_VERBS.has(verb),
        )
      : [];

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
      clientActions,
    };
  } catch {
    // Token-free breadcrumb only — never the raw token or any client data.
    console.error('delivery read failed', { hasSnapshot });
    return null;
  }
}

/** Coded outcomes the portal maps to a bilingual message. `already` is NOT here —
 *  a repeat action resolves to `{ ok: true, code: 'already' }` (idempotent). */
export type DeliveryActionError =
  | 'token_invalid'
  | 'token_expired'
  | 'not_active'
  | 'wrong_state';

export interface DeliveryActionResult {
  ok: boolean;
  /** Present only when the signal already existed — the action is a safe no-op. */
  code?: 'already';
  error?: DeliveryActionError;
}

/**
 * Session-less: record a client's APPEND-ONLY ADVISORY signal (approve /
 * request-changes / acknowledge) against a delivery by its RAW share token.
 * Mirrors respondToProposalByToken — sha256-hash the token (never sent in the
 * clear, never logged), run the SECURITY DEFINER write SDF on the base connection,
 * and map its status code. The SDF moves no state, adds no guard, and returns only
 * a status (no cost/margin). A repeat of an already-recorded signal maps to a
 * SUCCESSFUL no-op (`code: 'already'`), so a double submit is idempotent.
 */
export async function recordDeliveryActionByToken(
  rawToken: string,
  input: {
    action: string;
    note?: string | null;
    actorName?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<DeliveryActionResult> {
  if (!rawToken || !rawToken.trim()) return { ok: false, error: 'token_invalid' };
  const hash = hashToken(rawToken.trim());
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_delivery_respond_by_token(
      ${hash}, ${input.action}, ${input.note ?? null}, ${input.actorName ?? null},
      ${input.ip ?? null}, ${input.userAgent ?? null}
    ) as code`),
  )) as unknown as Array<{ code: string }>;
  const code = rows[0]?.code;
  switch (code) {
    case 'ok':
      return { ok: true };
    case 'already':
      return { ok: true, code: 'already' };
    case 'expired':
      return { ok: false, error: 'token_expired' };
    case 'not_active':
      return { ok: false, error: 'not_active' };
    case 'wrong_state':
      return { ok: false, error: 'wrong_state' };
    default:
      return { ok: false, error: 'token_invalid' };
  }
}
