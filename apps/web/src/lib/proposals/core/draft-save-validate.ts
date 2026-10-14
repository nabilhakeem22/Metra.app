// Stage 1 of the draft save, beside the header (./draft-save-header): the price
// rule a BOQ proposal follows, and the payload caps refused before any DB work.
// Pure (no DB) — throws coded ActionErrors via `fail`.
import type { ProposalKind } from '@metra/db';
import { fail } from '@/lib/actions/mutate';
import {
  MAX_LINES_PER_SECTION,
  MAX_SECTIONS,
  MAX_TOTAL_LINES,
} from '@/lib/lines/limits';
import type { ResolvedHeader } from './draft-save-header';
import type { SectionInput } from './types';

/**
 * A BOQ proposal is priced before VAT and supervision: both are added at the
 * contract. Forced to zero HERE, server-side, whatever the browser sent, so the
 * `proposals_boq_unpriced_draft` CHECK is never the first thing to say no.
 */
export function pricingForKind(kind: ProposalKind, header: ResolvedHeader): ResolvedHeader {
  return kind === 'boq' ? { ...header, taxRate: '0', supervisionPct: '0' } : header;
}

/** R2 boundary caps — reject oversized payloads before doing any work. */
export function enforceLineCaps(sections: SectionInput[]): void {
  if (sections.length > MAX_SECTIONS) fail('too_many_lines');
  let totalLines = 0;
  for (const section of sections) {
    if (section.lines.length > MAX_LINES_PER_SECTION) fail('too_many_lines');
    totalLines += section.lines.length;
  }
  if (totalLines > MAX_TOTAL_LINES) fail('too_many_lines');
}
