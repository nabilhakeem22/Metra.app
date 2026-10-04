import 'server-only';
import { boqs, type MetraDb } from '@metra/db';
import { and, desc, eq, ne } from 'drizzle-orm';
import { formatDocNumber } from '@/lib/format/doc-number';

/** A BOQ that Send as BOQ already produced. */
export interface SentBoq {
  boqId: string;
  documentNumber: string;
}

/**
 * Was THIS revision of the proposal already sent? The latest live BOQ cut from
 * the proposal, when its `source_revision` is `revision`, else null.
 *
 * This is what makes Send as BOQ idempotent per revision: a retried or doubled
 * send of contents that are already out returns the BOQ that exists rather than
 * issuing an identical second version under a new number. A send of a NEWER
 * revision finds an older token here and goes ahead as the next version.
 *
 * `revision` is the epoch-microsecond text token, compared as text (never as a
 * Date, which has only milliseconds).
 */
export async function findSentRevision(
  tx: MetraDb,
  proposalId: string,
  revision: string,
): Promise<SentBoq | null> {
  const [latest] = await tx
    .select({
      id: boqs.id,
      number: boqs.number,
      createdAt: boqs.createdAt,
      sourceRevision: boqs.sourceRevision,
    })
    .from(boqs)
    .where(and(eq(boqs.sourceProposalId, proposalId), ne(boqs.status, 'superseded')))
    .orderBy(desc(boqs.createdAt))
    .limit(1);
  if (!latest || latest.sourceRevision !== revision) return null;
  return {
    boqId: latest.id,
    documentNumber: formatDocNumber(
      'BQ',
      latest.number,
      new Date(latest.createdAt).getUTCFullYear(),
    ),
  };
}
