'use client';

import { useTranslations } from 'next-intl';

/** The milestone kinds the portal has a bilingual label for. */
const KNOWN_KINDS = new Set(['deposit', 'gate_a', 'gate_b', 'balance']);

/**
 * The client-facing name of a payment milestone ("Deposit", "First payment"...).
 * A kind the catalog has no label for falls back to the raw kind rather than
 * throwing MISSING_MESSAGE on a valid link.
 */
export function useMilestoneLabel(): (milestoneKind: string) => string {
  const t = useTranslations('delivery.payments.kind');
  return (milestoneKind) => (KNOWN_KINDS.has(milestoneKind) ? t(milestoneKind) : milestoneKind);
}
