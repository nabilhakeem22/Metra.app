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
  offPlan: boolean;
  titleAr: string | null;
  titleEn: string | null;
  createdAt: string;
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

/** The raw jsonb shape the SDF returns (snake_case, matches app_delivery_by_token). */
interface DeliverySnapshot {
  id: string;
  number: number;
  state: string;
  off_plan: boolean;
  title_ar: string | null;
  title_en: string | null;
  created_at: string;
  design_fee_total: string | null;
  rom: { low: string | null; high: string | null } | null;
  share_expires_at: string | null;
  firm: { name_ar: string | null; name_en: string | null; logo_file_id: string | null };
  client: { name_ar: string | null; name_en: string | null };
  payment_schedule: PublicDeliveryMilestone[];
  client_actions: string[];
}

const STATE_SET = new Set<string>(DESIGN_STATES);

/**
 * Resolve a delivery by its RAW share token, or null. The token is sha256-hashed
 * here (never sent to the DB in the clear) and the SECURITY DEFINER SDF returns
 * null for an unknown / revoked / expired link. Maps the raw `state` to its
 * client-friendly bilingual label. Server-only; never logs the raw token.
 */
export async function getDeliveryByToken(
  rawToken: string,
): Promise<PublicDelivery | null> {
  if (!rawToken || !rawToken.trim()) return null;
  const hash = hashToken(rawToken.trim());
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_delivery_by_token(${hash}) as data`),
  )) as unknown as Array<{ data: DeliverySnapshot | null }>;
  const snapshot = rows[0]?.data ?? null;
  if (!snapshot) return null;

  // Defensive: the state always comes from the DB enum, but if it is ever
  // unrecognised we must NOT render a raw/unknown key to the client.
  if (!STATE_SET.has(snapshot.state)) return null;
  const state = snapshot.state as DesignState;

  return {
    id: snapshot.id,
    number: snapshot.number,
    stageLabel: PORTAL_STAGE_LABEL[state],
    stageNote: PORTAL_STAGE_NOTE[state],
    offPlan: snapshot.off_plan,
    titleAr: snapshot.title_ar,
    titleEn: snapshot.title_en,
    createdAt: snapshot.created_at,
    designFeeTotal: snapshot.design_fee_total,
    rom: snapshot.rom,
    shareExpiresAt: snapshot.share_expires_at,
    firm: {
      nameAr: snapshot.firm.name_ar,
      nameEn: snapshot.firm.name_en,
      logoFileId: snapshot.firm.logo_file_id,
    },
    client: {
      nameAr: snapshot.client.name_ar,
      nameEn: snapshot.client.name_en,
    },
    paymentSchedule: snapshot.payment_schedule ?? [],
    clientActions: snapshot.client_actions ?? [],
  };
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
