'use client';

import { useTranslations } from 'next-intl';

/** The payment kinds the portal has a bilingual label for: the four milestones,
 *  and the design-changes payment a receipt can name. */
const KNOWN_KINDS = new Set(['deposit', 'gate_a', 'gate_b', 'balance', 'revision_co']);

/**
 * The client-facing name of a payment milestone ("Deposit", "First payment"...).
 * A kind the catalog has no label for reads as a plain "Payment": never the raw
 * machine key, and never MISSING_MESSAGE on a valid link.
 */
export function useMilestoneLabel(): (milestoneKind: string) => string {
  const t = useTranslations('delivery.payments.kind');
  return (milestoneKind) => t(KNOWN_KINDS.has(milestoneKind) ? milestoneKind : 'other');
}
