// Round C, C2: the draft save writes only what changed.
//  AC 5  one edited line of a 2,000-line draft is one proposal_lines row version;
//        nothing inserted or deleted; a text edit leaves every section alone, a
//        figure edit rewrites only its own section's cached subtotal.
//  AC 6  that save's WAL stays under 64 KB; the median server time of 5 saves is
//        printed (the < 150 ms target is measured on a local Postgres, never on
//        the shared database; CI holds the slower ceiling below).
//  AC 8  another proposal's line id names a NEW line here; theirs is untouched.
import { afterAll, describe, expect, it } from 'vitest';
import { createProposalCore, saveProposalDraftCore } from '@/lib/proposals/core';
import { closeFixture, raw, teardown } from './fixture';
import {
  changedIds,
  draftDocument,
  draftFixture,
  rowVersions,
  walBytesSince,
  walPosition,
} from './proposal-draft-fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** CI runners are slower than a developer machine; the local target is 150 ms. */
const CI_CEILING_MS = 1000;
const WAL_CEILING_BYTES = 65_536;

describe('one edited line in a 2,000-line draft', () => {
  it('is one row version, < 64 KB of WAL, and a fast save', async () => {
    const { owner, proposalId } = await draftFixture(orgIds);
    const first = await saveProposalDraftCore(owner, { id: proposalId, sections: draftDocument(2000) });
    expect(first.ok).toBe(true);
    const receipt = first.data!.sections;
    let revision = first.data!.revision;

    const timings: number[] = [];
    const walSizes: number[] = [];
    for (let edit = 0; edit < 5; edit += 1) {
      const before = await rowVersions(proposalId);
      const sections = draftDocument(2000, receipt);
      const edited = sections[3].lines[40];
      edited.descriptionEn = `Edited description ${edit}`;
      const wal = await walPosition();
      const started = performance.now();
      const saved = await saveProposalDraftCore(owner, { id: proposalId, revision, sections });
      timings.push(performance.now() - started);
      walSizes.push(await walBytesSince(wal));
      expect(saved.ok).toBe(true);
      revision = saved.data!.revision;
      expect(saved.data!.sections).toEqual(receipt);

      const after = await rowVersions(proposalId);
      expect(changedIds(before.lines, after.lines)).toEqual([receipt[3].lineIds[40]]);
      expect(after.lines.size).toBe(2000);
      expect(changedIds(before.sections, after.sections)).toEqual([]);
      expect(after.sections.size).toBe(20);
    }
    const median = [...timings].sort((a, b) => a - b)[2];
    console.info('C2 diff save, 2,000 lines, one text edit', {
      medianMs: Math.round(median),
      timingsMs: timings.map(Math.round),
      walBytes: walSizes,
    });
    expect(Math.max(...walSizes)).toBeLessThan(WAL_CEILING_BYTES);
    expect(median).toBeLessThan(CI_CEILING_MS);
  });

  it('a figure edit rewrites its line and only its own section subtotal', async () => {
    const { owner, proposalId } = await draftFixture(orgIds);
    const first = await saveProposalDraftCore(owner, { id: proposalId, sections: draftDocument(2000) });
    const receipt = first.data!.sections;
    const before = await rowVersions(proposalId);
    const sections = draftDocument(2000, receipt);
    sections[7].lines[12].qty = '13';
    const wal = await walPosition();
    const saved = await saveProposalDraftCore(owner, { id: proposalId, revision: first.data!.revision, sections });
    const walBytes = await walBytesSince(wal);
    expect(saved.ok).toBe(true);
    const after = await rowVersions(proposalId);
    expect(changedIds(before.lines, after.lines)).toEqual([receipt[7].lineIds[12]]);
    expect(changedIds(before.sections, after.sections)).toEqual([receipt[7].id]);
    console.info('C2 diff save, 2,000 lines, one qty edit', { walBytes });
    expect(walBytes).toBeLessThan(WAL_CEILING_BYTES);
  });

  it('an unchanged save writes no line or section row at all', async () => {
    const { owner, proposalId } = await draftFixture(orgIds);
    const first = await saveProposalDraftCore(owner, { id: proposalId, sections: draftDocument(300) });
    const before = await rowVersions(proposalId);
    const again = await saveProposalDraftCore(owner, {
      id: proposalId,
      sections: draftDocument(300, first.data!.sections),
    });
    expect(again.ok).toBe(true);
    const after = await rowVersions(proposalId);
    expect(changedIds(before.lines, after.lines)).toEqual([]);
    expect(changedIds(before.sections, after.sections)).toEqual([]);
  });
});

describe("another proposal's line id (AC 8)", () => {
  it('saves a NEW line under a new id and leaves the other proposal of the same org untouched', async () => {
    const { owner, proposalId: theirId } = await draftFixture(orgIds);
    const theirSave = await saveProposalDraftCore(owner, { id: theirId, sections: draftDocument(3) });
    const foreignLineId = theirSave.data!.sections[0].lineIds[1];
    const foreignSectionId = theirSave.data!.sections[0].id;
    const theirBefore = await rowVersions(theirId);

    const [parent] = await raw.query<{ client_id: string; project_id: string }>(
      `select client_id, project_id from public.proposals where id = '${theirId}'`,
    );
    const created = await createProposalCore(owner, { clientId: parent.client_id, projectId: parent.project_id });
    const ourId = (created as { data?: string }).data!;
    const sections = draftDocument(2);
    sections[0].id = foreignSectionId;
    sections[0].lines[1].id = foreignLineId;
    const saved = await saveProposalDraftCore(owner, { id: ourId, sections });
    expect(saved.ok).toBe(true);
    const stored = saved.data!.sections[0];
    expect(stored.id).not.toBe(foreignSectionId);
    expect(stored.lineIds).toHaveLength(2);
    expect(stored.lineIds).not.toContain(foreignLineId);
    expect([...(await rowVersions(ourId)).lines.keys()].sort()).toEqual([...stored.lineIds].sort());
    expect(await rowVersions(theirId)).toEqual(theirBefore);
  });
});
