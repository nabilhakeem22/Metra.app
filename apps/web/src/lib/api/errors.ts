// RFC 7807 problem+json for the Public API (v1). Pure — no server-only deps, so
// it is unit-testable in plain vitest. Every response the API emits on an error
// path is built here so the envelope (type/title/status[/detail]) stays uniform.
import type { ActionCode } from '@/lib/actions/result';

const PROBLEM_BASE = 'https://api.metra.app/problems/';
const CONTENT_TYPE = 'application/problem+json';

/** The closed set of problem kinds the API surface can emit. */
export type ApiProblemKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'bad-request'
  | 'invalid-cursor'
  | 'rate-limited'
  | 'internal';

interface ProblemMeta {
  status: number;
  title: string;
}

const PROBLEM_META: Record<ApiProblemKind, ProblemMeta> = {
  unauthorized: { status: 401, title: 'Unauthorized' },
  forbidden: { status: 403, title: 'Forbidden' },
  'not-found': { status: 404, title: 'Not Found' },
  'bad-request': { status: 400, title: 'Bad Request' },
  'invalid-cursor': { status: 400, title: 'Invalid Cursor' },
  'rate-limited': { status: 429, title: 'Too Many Requests' },
  internal: { status: 500, title: 'Internal Server Error' },
};

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

/** Build the problem document (no Response wrapper) — used by serialize + tests. */
export function problemBody(kind: ApiProblemKind, detail?: string): Problem {
  const meta = PROBLEM_META[kind];
  const body: Problem = {
    type: `${PROBLEM_BASE}${kind}`,
    title: meta.title,
    status: meta.status,
  };
  if (detail) body.detail = detail;
  return body;
}

/** An `application/problem+json` Response for the given kind. */
export function problemResponse(
  kind: ApiProblemKind,
  opts: { detail?: string; headers?: Record<string, string> } = {},
): Response {
  const body = problemBody(kind, opts.detail);
  return new Response(JSON.stringify(body), {
    status: body.status,
    headers: { 'content-type': CONTENT_TYPE, ...(opts.headers ?? {}) },
  });
}

/**
 * Map every ActionCode to a problem kind. Read-only v1 rarely surfaces the write
 * codes, but the mapping is TOTAL (Record<ActionCode, …>) so a new code fails the
 * build until it is classified — and the unit test proves every code maps.
 */
export const ACTION_CODE_PROBLEM: Record<ActionCode, ApiProblemKind> = {
  forbidden: 'forbidden',
  invalid: 'bad-request',
  generic: 'internal',
  name_required: 'bad-request',
  last_owner: 'bad-request',
  owner_immutable: 'bad-request',
  self: 'bad-request',
  already_member: 'bad-request',
  pending_exists: 'bad-request',
  declined: 'forbidden',
  otp_send_failed: 'internal',
  otp_verify_failed: 'bad-request',
  immutable: 'bad-request',
  code_required: 'bad-request',
  code_taken: 'bad-request',
  invalid_percentage: 'bad-request',
  import_empty: 'bad-request',
  import_too_large: 'bad-request',
  client_required: 'bad-request',
  invalid_dates: 'bad-request',
  proposal_not_draft: 'bad-request',
  line_required: 'bad-request',
  token_invalid: 'unauthorized',
  token_expired: 'unauthorized',
  already_responded: 'bad-request',
  discount_out_of_range: 'bad-request',
  supervision_out_of_range: 'bad-request',
  too_many_lines: 'bad-request',
  invalid_date: 'bad-request',
  amount_too_large: 'bad-request',
  last_primary_contact: 'bad-request',
  contract_exists: 'bad-request',
  proposal_not_accepted: 'bad-request',
  contract_not_draft: 'bad-request',
  contract_not_issued: 'bad-request',
  contract_not_signable: 'bad-request',
  variation_not_draft: 'bad-request',
  variation_not_internal_approved: 'bad-request',
  variation_not_issued: 'bad-request',
  engagement_title_required: 'bad-request',
  engagement_client_required: 'bad-request',
  engagement_project_required: 'bad-request',
  engagement_not_found: 'bad-request',
  engagement_not_active: 'bad-request',
  illegal_trigger: 'bad-request',
  transition_not_yet_enabled: 'bad-request',
  engagement_state_conflict: 'bad-request',
  guard_scope_inputs_missing: 'bad-request',
  design_fee_required: 'bad-request',
  milestone_split_invalid: 'bad-request',
  milestone_kind_duplicate: 'bad-request',
  payment_amount_invalid: 'bad-request',
  deposit_not_cleared: 'bad-request',
  gate_a_not_cleared: 'bad-request',
  spatial_base_missing: 'bad-request',
  concept_options_out_of_range: 'bad-request',
  revision_co_amount_required: 'bad-request',
  revision_cos_outstanding: 'bad-request',
  renders_missing: 'bad-request',
  rom_range_invalid: 'bad-request',
  rom_not_set: 'bad-request',
};

/** A problem Response derived from an ActionResult error code. */
export function problemFromActionCode(
  code: ActionCode,
  detail?: string,
): Response {
  return problemResponse(ACTION_CODE_PROBLEM[code], { detail });
}
