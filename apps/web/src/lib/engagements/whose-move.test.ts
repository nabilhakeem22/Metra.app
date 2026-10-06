import { describe, expect, test } from 'vitest';
import type { CommandCardMode } from './command-card';
import type { GateChecklistItem } from './gate-preview';
import type { Trigger } from './transitions';
import { resolveWhoseMove, whoseMoveOfMode, type WhoseMove } from './whose-move';

describe('whoseMoveOfMode — 4 modes x claims 0/1', () => {
  const table: [CommandCardMode, number, WhoseMove][] = [
    ['closed', 0, 'closed'],
    ['closed', 1, 'closed'],
    ['ready', 0, 'studio'],
    ['ready', 1, 'confirmPayment'],
    ['blockedStudio', 0, 'studio'],
    ['blockedStudio', 1, 'confirmPayment'],
    ['blockedClient', 0, 'client'],
    ['blockedClient', 1, 'confirmPayment'],
  ];

  test.each(table)('%s + %i claims -> %s', (mode, claims, expected) => {
    expect(whoseMoveOfMode(mode, claims)).toBe(expected);
  });
});

describe('resolveWhoseMove', () => {
  const ENDINGS: Trigger[] = ['chooseDesignOnly', 'chooseExecution'];
  const balance = (ok: boolean): GateChecklistItem => ({
    guard: 'balanceCleared',
    ok,
    code: ok ? null : 'balance_not_cleared',
    amountDue: ok ? null : '1000.0000',
  });
  const choice = (balanceCleared: boolean) => ({
    primaryTrigger: null,
    endingChoices: ENDINGS,
    items: [balance(balanceCleared)],
    awaitingClientReview: false,
  });

  test('execution_decision with the balance cleared is the studio move', () => {
    expect(
      resolveWhoseMove({ state: 'execution_decision', preview: choice(true), pendingClaimCount: 0 }),
    ).toBe('studio');
  });

  test('execution_decision with the balance unpaid waits on the client', () => {
    expect(
      resolveWhoseMove({ state: 'execution_decision', preview: choice(false), pendingClaimCount: 0 }),
    ).toBe('client');
  });

  test('a pending claim is a payment to confirm', () => {
    expect(
      resolveWhoseMove({ state: 'execution_decision', preview: choice(false), pendingClaimCount: 1 }),
    ).toBe('confirmPayment');
  });

  test('a terminal state is closed, claims or not', () => {
    expect(
      resolveWhoseMove({
        state: 'execution',
        preview: { primaryTrigger: null, endingChoices: [], items: [], awaitingClientReview: false },
        pendingClaimCount: 1,
      }),
    ).toBe('closed');
  });

  test('a review stage with every guard met but no client answer waits on the client', () => {
    const conceptReview = (awaitingClientReview: boolean) => ({
      primaryTrigger: 'selectConcept' as const,
      endingChoices: [],
      items: [{ guard: 'gateAInstallmentCleared' as const, ok: true, code: null, amountDue: null }],
      awaitingClientReview,
    });
    expect(
      resolveWhoseMove({ state: 'concept_review', preview: conceptReview(true), pendingClaimCount: 0 }),
    ).toBe('client');
    expect(
      resolveWhoseMove({ state: 'concept_review', preview: conceptReview(false), pendingClaimCount: 0 }),
    ).toBe('studio');
  });
});
