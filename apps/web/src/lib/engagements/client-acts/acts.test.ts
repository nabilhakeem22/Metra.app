import { describe, expect, it } from 'vitest';
import { can } from '@/lib/permissions/can';
import { MEMBER_ROLES } from '@/lib/permissions/member-roles';
import {
  CLIENT_ACT_BODY_KEY,
  clientActOfVerb,
  clientActParams,
  paymentClaimedAct,
  recipientRolesFor,
  type ClientActKind,
} from './acts';

// The server-side map behind app_delivery_notify_studio_by_token's caller
// contract: key, roles and params come from the act, never from the request.

/** The nine keys the SQL function's v_allowed array accepts (50-delivery-write.sql). */
const SQL_ALLOWED_KEYS = [
  'client_concept_approved',
  'client_concept_chosen',
  'client_concept_changes_requested',
  'client_design_approved',
  'client_design_changes_requested',
  'client_budget_acknowledged',
  'client_handover_acknowledged',
  'client_payment_claimed',
  'client_commented',
];

describe('CLIENT_ACT_BODY_KEY', () => {
  it('names exactly the nine keys the notifier allows', () => {
    expect(Object.values(CLIENT_ACT_BODY_KEY).sort()).toEqual([...SQL_ALLOWED_KEYS].sort());
  });
});

describe('clientActOfVerb', () => {
  it.each([
    ['approve_concept', 'concept_approved'],
    ['request_concept_changes', 'concept_changes_requested'],
    ['approve_design', 'design_approved'],
    ['request_design_changes', 'design_changes_requested'],
    ['acknowledge_rom', 'budget_acknowledged'],
    ['acknowledge_handoff', 'handover_acknowledged'],
  ] as const)('%s records %s', (verb, kind) => {
    expect(clientActOfVerb(verb)).toEqual({ kind });
  });

  it.each(['', 'approve', 'constructor', '__proto__', 'toString', 'client_commented'])(
    'answers null for %j',
    (verb) => {
      expect(clientActOfVerb(verb)).toBeNull();
    },
  );
});

describe('paymentClaimedAct', () => {
  it.each(['deposit', 'gate_a', 'gate_b', 'balance'])('carries the %s milestone', (kind) => {
    expect(paymentClaimedAct(kind)).toEqual({ kind: 'payment_claimed', milestoneKind: kind });
  });

  it.each(['', 'retention', 'DEPOSIT', 'constructor'])('refuses %j', (kind) => {
    expect(paymentClaimedAct(kind)).toBeNull();
  });
});

describe('recipientRolesFor (owner decision Q2)', () => {
  const designActs: ClientActKind[] = [
    'concept_approved',
    'concept_chosen',
    'concept_changes_requested',
    'design_approved',
    'design_changes_requested',
    'budget_acknowledged',
    'handover_acknowledged',
    'commented',
  ];

  it.each(designActs)('%s reaches owner, admin, project manager and site engineer', (kind) => {
    expect(recipientRolesFor({ kind })).toEqual([
      'owner',
      'admin',
      'project_manager',
      'site_engineer',
    ]);
  });

  it('a payment claim reaches owner, admin and accountant', () => {
    expect(recipientRolesFor({ kind: 'payment_claimed', milestoneKind: 'deposit' })).toEqual([
      'owner',
      'admin',
      'accountant',
    ]);
  });

  it('is computed from the matrix, not a literal list', () => {
    const fromMatrix = MEMBER_ROLES.filter(
      (role) => role !== 'client' && can(role, 'engagements_design', 'update'),
    );
    expect(recipientRolesFor({ kind: 'commented' })).toEqual(fromMatrix);
    for (const kind of [...designActs, 'payment_claimed' as const]) {
      expect(recipientRolesFor({ kind })).not.toContain('client');
      expect(recipientRolesFor({ kind })).not.toContain('viewer');
    }
  });
});

describe('clientActParams', () => {
  it('carries the milestone of a payment claim and nothing else', () => {
    expect(clientActParams({ kind: 'payment_claimed', milestoneKind: 'gate_b' })).toEqual({
      milestoneKind: 'gate_b',
    });
    expect(clientActParams({ kind: 'design_approved' })).toEqual({});
  });
});
