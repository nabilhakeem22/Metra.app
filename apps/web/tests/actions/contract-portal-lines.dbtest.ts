import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contractPayloadHash,
  getContractByToken,
  getContractSectionLinesByToken,
  withOpeningLines,
} from '@/lib/contracts/public';
import { closeExecutionFixture, seedExecutionContract, tamper, type ExecutionContract } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// PR A3.6, AC11 and AC12 through the app's own reader: the /c page opens on the
// first 50 lines of the contract, "show more" fetches the rest 100 at a time, a
// section of another contract answers nothing, and the acknowledgement hash
// covers every line whether or not the snapshot carries it.

const orgIds: string[] = [];
let contract: ExecutionContract;
let other: ExecutionContract;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId);
  contract = await seedExecutionContract(seeded.orgId, {
    linesPerSection: [350, 250],
    state: 'issued',
    schedule: [{ labelEn: 'All', basis: 'percent', value: '100' }],
  });
  other = await seedExecutionContract(seeded.orgId, { linesPerSection: [3], state: 'issued' });
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

describe('the /c page on a 600-line contract (AC11)', () => {
  it('opens on the first 50 lines of the whole contract; a section past them opens collapsed', async () => {
    const opened = withOpeningLines((await getContractByToken(contract.rawToken!))!);
    expect(opened.sections.map((section) => [section.lines.length, section.line_count])).toEqual([
      [50, 350],
      [0, 250],
    ]);
    expect(opened.sections[0].lines.map((line) => line.id)).toEqual(contract.lineIds[0].slice(0, 50));
  });

  it('"show more" continues at the 51st line, 100 at a time, to the end', async () => {
    const page = await getContractSectionLinesByToken(contract.rawToken!, contract.sectionIds[0], 50);
    expect(page?.lines.map((line) => line.id)).toEqual(contract.lineIds[0].slice(50, 150));
    const last = await getContractSectionLinesByToken(contract.rawToken!, contract.sectionIds[0], 300);
    expect(last?.lines).toHaveLength(50);
    expect(last?.line_count).toBe(350);
  });

  it('answers null for a section of another contract, a bad id, a bad offset and a bad token', async () => {
    const token = contract.rawToken!;
    expect(await getContractSectionLinesByToken(token, other.sectionIds[0], 0)).toBeNull();
    expect(await getContractSectionLinesByToken(token, 'not-an-id', 0)).toBeNull();
    for (const offset of [-1, 1.5, 100_001, '50', null]) {
      expect(await getContractSectionLinesByToken(token, contract.sectionIds[0], offset)).toBeNull();
    }
    expect(await getContractSectionLinesByToken('nope', contract.sectionIds[0], 0)).toBeNull();
  });
});

describe('the acknowledgement hash (AC12)', () => {
  it('is the same over the full snapshot and the opened one, so step B does not move it', async () => {
    const full = (await getContractByToken(contract.rawToken!))!;
    expect(contractPayloadHash(withOpeningLines(full))).toBe(contractPayloadHash(full));
  });

  it('moves when a line the page never opened differs', async () => {
    const before = contractPayloadHash(withOpeningLines((await getContractByToken(contract.rawToken!))!));
    await tamper(`update public.contract_lines set qty = qty + 1 where id = $1`, [contract.lineIds[1][200]]);
    const after = contractPayloadHash(withOpeningLines((await getContractByToken(contract.rawToken!))!));
    expect(after).not.toBe(before);
  });
});
