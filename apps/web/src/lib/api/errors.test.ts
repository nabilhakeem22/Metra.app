import { describe, expect, it } from 'vitest';
import {
  ACTION_CODE_PROBLEM,
  problemBody,
  problemFromActionCode,
  problemResponse,
} from './errors';
import type { ActionCode } from '@/lib/actions/result';

// The full ActionCode union, mirrored so the test fails loudly if a code is added
// without a problem mapping. (ACTION_CODE_PROBLEM is Record<ActionCode,…>, so a
// missing code already fails tsc; this asserts the runtime map too.)
const ALL_CODES: ActionCode[] = [
  'forbidden',
  'invalid',
  'generic',
  'name_required',
  'last_owner',
  'owner_immutable',
  'self',
  'already_member',
  'pending_exists',
  'declined',
  'otp_send_failed',
  'otp_verify_failed',
  'immutable',
  'code_required',
  'code_taken',
  'invalid_percentage',
  'import_empty',
  'import_too_large',
  'client_required',
  'invalid_dates',
  'proposal_not_draft',
  'line_required',
  'token_invalid',
  'token_expired',
  'already_responded',
  'discount_out_of_range',
  'supervision_out_of_range',
  'too_many_lines',
  'invalid_date',
  'amount_too_large',
  'last_primary_contact',
  'contract_exists',
  'proposal_not_accepted',
  'contract_not_draft',
  'contract_not_issued',
  'contract_not_signable',
  'variation_not_draft',
  'variation_not_internal_approved',
  'variation_not_issued',
  'engagement_title_required',
  'engagement_client_required',
  'engagement_project_required',
  'engagement_not_found',
  'illegal_trigger',
  'transition_not_yet_enabled',
  'engagement_state_conflict',
  'guard_scope_inputs_missing',
];

describe('problem+json envelope', () => {
  it('builds a well-formed problem body with the metra type URI', () => {
    const body = problemBody('not-found', 'missing');
    expect(body).toEqual({
      type: 'https://api.metra.app/problems/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'missing',
    });
  });

  it('omits detail when not provided', () => {
    expect(problemBody('unauthorized')).not.toHaveProperty('detail');
  });

  it('serves application/problem+json with the matching status + headers', async () => {
    const res = problemResponse('rate-limited', {
      headers: { 'retry-after': '60' },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(res.headers.get('retry-after')).toBe('60');
    const json = (await res.json()) as { status: number };
    expect(json.status).toBe(429);
  });
});

describe('ActionCode -> problem mapping', () => {
  it('maps EVERY ActionCode to a known problem kind', () => {
    for (const code of ALL_CODES) {
      expect(ACTION_CODE_PROBLEM[code], `unmapped code: ${code}`).toBeTruthy();
    }
  });

  it('the tested code list matches the map exactly (no drift)', () => {
    expect(new Set(ALL_CODES)).toEqual(
      new Set(Object.keys(ACTION_CODE_PROBLEM)),
    );
  });

  it('forbidden -> 403, invalid -> 400, generic -> 500', () => {
    expect(problemFromActionCode('forbidden').status).toBe(403);
    expect(problemFromActionCode('invalid').status).toBe(400);
    expect(problemFromActionCode('generic').status).toBe(500);
  });
});
