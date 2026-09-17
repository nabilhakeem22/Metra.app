import 'server-only';
// The FREEZE RULE, in one place. Every edit core below reloads the parent BOQ and
// refuses anything that is not `draft`. Hiding the inputs on an issued document is
// a courtesy to the studio; this is the part that actually holds, because once
// issued the PDF in the client's hands and the rows in this table must never drift
// apart (see ../issue.ts).
import { boqLines, boqs } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';

export type Tx = Parameters<Parameters<typeof mutateInOrg>[2]>[0];

/** What every line edit needs about the document the line belongs to. */
interface DraftLineParent {
  boqId: string;
  sectionId: string;
  discountPct: string;
}

/** Look up a line's BOQ and refuse unless that document is still a draft. */
export async function loadDraftForLine(
  tx: Tx,
  lineId: string,
): Promise<DraftLineParent> {
  const [row] = await tx
    .select({
      boqId: boqLines.boqId,
      sectionId: boqLines.sectionId,
      status: boqs.status,
      discountPct: boqs.discountPct,
    })
    .from(boqLines)
    .innerJoin(boqs, eq(boqs.id, boqLines.boqId))
    .where(eq(boqLines.id, lineId))
    .limit(1);
  if (!row) fail('line_not_found');
  if (row.status !== 'draft') fail('boq_not_draft');
  return {
    boqId: row.boqId,
    sectionId: row.sectionId,
    discountPct: row.discountPct,
  };
}
