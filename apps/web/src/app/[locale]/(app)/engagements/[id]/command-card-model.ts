import { deriveCommandCard, type CommandCardView } from '@/lib/engagements/command-card';
import {
  resolveCommandCardChrome,
  type CommandCardChrome,
} from '@/lib/engagements/command-card-chrome';
import { resolveCommandCardCtas, type CommandCardCtas } from '@/lib/engagements/command-card-ctas';
import { isTerminal } from '@/lib/engagements/states';
import type { EngagementCommandCardProps } from './command-card-props';

/** The three pure derivations the command card renders from, in one place. */
export interface CommandCardModel {
  view: CommandCardView;
  closed: boolean;
  chrome: CommandCardChrome;
  ctas: CommandCardCtas;
}

/**
 * Derive the card's view, chrome and controls from its props. A plain module
 * (no React, no 'use client'): each rule is a tested function in
 * lib/engagements/command-card-{,chrome,ctas}.ts; this only wires them together.
 */
export function deriveCommandCardModel(props: EngagementCommandCardProps): CommandCardModel {
  const view = deriveCommandCard(props.preview, {
    canAdvance: props.canAdvance,
    isTerminal: isTerminal(props.state),
  });
  const closed = view.mode === 'closed';
  const chrome = resolveCommandCardChrome({
    mode: view.mode,
    paymentClaimCount: props.paymentClaimCount,
  });
  const ctas = resolveCommandCardCtas(props.preview, {
    canRecordPayment: props.canRecordPayment,
    canAdvance: props.canAdvance,
    canUpload: props.canUpload,
    state: props.state,
    mode: view.mode,
    closed,
    conceptOptionCount: props.conceptOptionCount,
    pendingClaimCount: props.paymentClaimCount,
    canResolveClaims: props.canResolveClaims,
  });
  return { view, closed, chrome, ctas };
}
