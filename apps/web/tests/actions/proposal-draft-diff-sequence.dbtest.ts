// Round C, C2, AC 7: the diff save stores what a full rewrite stores.
// One document is edited step by step (edit, insert mid-section, delete, move a
// line to another section, reorder sections, rename a section, empty it). Draft
// A saves each step with the ids its receipts gave (the diff path: updates);
// draft B saves the same step with NO ids, which is a full rewrite (every row
// deleted and inserted). After every step both drafts must hold the same rows,
// column by column except ids and timestamps, and A's receipt must name its
// stored rows in the order they were sent.
import { afterAll, describe, expect, it } from 'vitest';
import { saveProposalDraftCore } from '@/lib/proposals/core';
import { closeFixture, raw, teardown } from './fixture';
import { changedIds, draftFixture, rowVersions, storedRows, type DraftSections } from './proposal-draft-fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

type Line = DraftSections[number]['lines'][number];

function line(tag: string, qty = '2', price = '100'): Line {
  return { descriptionEn: `Line ${tag}`, qty, unit: 'sqm', unitCost: '60', unitPrice: price, discountPct: '0' };
}

const withoutIds = (sections: DraftSections): DraftSections =>
  sections.map((section) => ({ ...section, id: null, lines: section.lines.map((entry) => ({ ...entry, id: null })) }));

/** A's stored ids, in document order, as the database orders them. */
async function storedOrder(proposalId: string) {
  const rows = await raw.query<{ section_id: string; line_id: string | null }>(
    `select s.id as section_id, l.id as line_id from public.proposal_sections s
       left join public.proposal_lines l on l.section_id = s.id
      where s.proposal_id = '${proposalId}' order by s.sort_order, l.sort_order`,
  );
  const sections: { id: string; lineIds: string[] }[] = [];
  for (const row of rows) {
    if (sections.at(-1)?.id !== row.section_id) sections.push({ id: row.section_id, lineIds: [] });
    if (row.line_id) sections.at(-1)!.lineIds.push(row.line_id);
  }
  return sections;
}

describe('the diff save against a full rewrite (AC 7)', () => {
  it('stores identical rows after every step, and the receipt names them in sent order', async () => {
    const a = await draftFixture(orgIds);
    const b = await draftFixture(orgIds);
    let doc: DraftSections = [
      { titleEn: 'Floors', lines: [line('f0'), line('f1'), line('f2'), line('f3')] },
      { titleEn: 'Ceilings', titleAr: 'الأسقف', lines: [line('c0'), line('c1'), line('c2')] },
      { titleEn: 'Walls', lines: [line('w0'), line('w1')] },
    ];

    async function saveBoth(step: string) {
      const savedA = await saveProposalDraftCore(a.owner, { id: a.proposalId, sections: doc });
      const savedB = await saveProposalDraftCore(b.owner, { id: b.proposalId, sections: withoutIds(doc) });
      expect(savedA.ok && savedB.ok, step).toBe(true);
      const receipt = savedA.data!.sections;
      expect(await storedOrder(a.proposalId), step).toEqual(receipt);
      expect(await storedRows(a.proposalId), step).toEqual(await storedRows(b.proposalId));
      doc = doc.map((section, sectionIndex) => ({
        ...section,
        id: receipt[sectionIndex].id,
        lines: section.lines.map((entry, lineIndex) => ({ ...entry, id: receipt[sectionIndex].lineIds[lineIndex] })),
      }));
    }

    await saveBoth('first save');
    doc[0].lines[2] = { ...doc[0].lines[2], qty: '7.25', discountPct: '10', descriptionAr: 'بند معدل' };
    await saveBoth('edit');
    doc[1].lines.splice(1, 0, line('c-new', '3', '250'));
    await saveBoth('insert mid-section');
    doc[0].lines.splice(1, 1);
    await saveBoth('delete');
    doc[0].lines.push(doc[2].lines.shift()!);
    await saveBoth('move a line to another section');
    doc = [doc[1], doc[0], doc[2]];
    await saveBoth('reorder sections');
    doc[2] = { ...doc[2], titleEn: 'Walls and paint', titleAr: 'الحوائط' };
    await saveBoth('rename a section');
    doc = [];
    await saveBoth('empty the document');
    expect(await storedRows(a.proposalId)).toEqual([]);
    const [{ lines }] = await raw.query<{ lines: number }>(
      `select count(*)::int as lines from public.proposal_lines where proposal_id = '${a.proposalId}'`,
    );
    expect(lines).toBe(0);
  });
});

describe('a margin-blind caller (F1)', () => {
  it('keeps every stored cost, and its qty edit touches only that line', async () => {
    const { owner, pm, proposalId } = await draftFixture(orgIds);
    const first = await saveProposalDraftCore(owner, {
      id: proposalId,
      sections: [{ titleEn: 'Floors', lines: [line('f0'), { ...line('f1'), unitCost: '75.5' }] }],
    });
    const receipt = first.data!.sections[0];
    const before = await rowVersions(proposalId);
    const blind = await saveProposalDraftCore(pm, {
      id: proposalId,
      revision: first.data!.revision,
      sections: [
        {
          id: receipt.id,
          titleEn: 'Floors',
          lines: [
            { ...line('f0'), id: receipt.lineIds[0], unitCost: null },
            { ...line('f1', '5'), id: receipt.lineIds[1], unitCost: null },
          ],
        },
      ],
    });
    expect(blind.ok).toBe(true);
    const after = await rowVersions(proposalId);
    expect(changedIds(before.lines, after.lines)).toEqual([receipt.lineIds[1]]);
    const costs = await raw.query<{ unit_cost: string; line_cost: string }>(
      `select unit_cost::text, line_cost::text from public.proposal_lines
        where proposal_id = '${proposalId}' order by sort_order`,
    );
    expect(costs).toEqual([
      { unit_cost: '60.0000', line_cost: '120.0000' },
      { unit_cost: '75.5000', line_cost: '377.5000' },
    ]);
  });
});
