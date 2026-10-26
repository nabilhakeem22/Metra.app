import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadHomeContractSectionLines, loadHomeContractSections, openHomeContract } from '@/app/[locale]/d/[token]/contract-actions';
import { contractDocumentOf, getHomeContract } from '@/lib/client-home/contract';
import { terminateContractCore } from '@/lib/contracts/lifecycle/terminate';
import type { PublicContract } from '@/lib/contracts/public-types';
import type { OrgContext } from '@/lib/db/context';
import { seedHome } from './client-home-fixture';
import { seedDelivery } from './delivery-execution-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// H6.2, the read, through the app's own readers and actions against the real
// SQL: the home's contract document is the /c snapshot of the SAME contract
// (the document part of it), its section pages and lines are /c's, a section
// of another contract is gone, and a contract the home does not show (a
// terminated one, another contract's id) is never handed over. The pages are
// bound to the contract the document was opened on (DB step D): after the
// studio terminates it and issues another, they answer gone (H6-read F1).

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  orgIds.push(orgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const scalar = async <T>(text: string, params: unknown[] = []): Promise<T> =>
  (await ownerQuery<{ value: T }>(`select ${text} as value`, params))[0].value;

const contractHashOf = async (contractId: string) =>
  (await ownerQuery<{ token_hash: string }>(`select token_hash from public.contracts where id = $1`, [contractId]))[0].token_hash;

describe('the home contract document (H6.2, AC19)', () => {
  it.each(['issued', 'signed'] as const)('%s: the document is /c\'s snapshot of the same contract, and so are its pages', async (state) => {
    const home = await seedHome(orgId, state);
    const viaLink = await scalar<PublicContract>(`public.app_contract_by_token($1)`, [await contractHashOf(home.contract.contractId)]);
    expect(await getHomeContract(home.delivery.rawToken)).toEqual(contractDocumentOf(viaLink));
    expect(await openHomeContract(home.delivery.rawToken, home.contract.contractId)).toEqual({ ok: true, contract: contractDocumentOf(viaLink) });

    const [section] = home.contract.sectionIds;
    const linesByLink = await scalar(`public.app_contract_section_lines_by_token($1, $2::uuid, 0)`, [await contractHashOf(home.contract.contractId), section]);
    expect(await loadHomeContractSectionLines(home.delivery.rawToken, home.contract.contractId, section, 0)).toEqual({ ok: true, page: linesByLink });
    const sectionsByLink = await scalar(`public.app_contract_sections_by_token($1, 0)`, [await contractHashOf(home.contract.contractId)]);
    expect(await loadHomeContractSections(home.delivery.rawToken, home.contract.contractId, 0)).toEqual({ ok: true, page: sectionsByLink });
  });

  it('a section of another contract is gone; another contract id is gone', async () => {
    const home = await seedHome(orgId, 'issued');
    const other = await seedHome(orgId, 'issued');
    expect(await loadHomeContractSectionLines(home.delivery.rawToken, home.contract.contractId, other.contract.sectionIds[0], 0)).toEqual({ ok: false, error: 'gone' });
    expect(await openHomeContract(home.delivery.rawToken, other.contract.contractId)).toEqual({ ok: false, error: 'gone' });
  });

  it('a terminated contract is not handed over: the card shows it, the document does not open', async () => {
    const home = await seedHome(orgId, 'signed');
    expect((await terminateContractCore(owner, { id: home.contract.contractId })).ok).toBe(true);
    expect(await getHomeContract(home.delivery.rawToken)).toBeNull();
    expect(await openHomeContract(home.delivery.rawToken, home.contract.contractId)).toEqual({ ok: false, error: 'gone' });
    expect(await loadHomeContractSections(home.delivery.rawToken, home.contract.contractId, 0)).toEqual({ ok: false, error: 'gone' });
  });

  it('F1: terminated and re-issued while open, more sections and the section lines of the opened document are gone', async () => {
    const delivery = await seedDelivery(orgId);
    const fiftyFive = Array.from({ length: 55 }, () => 1);
    const opened = await seedExecutionContract(orgId, { state: 'signed', delivery, linesPerSection: fiftyFive });
    expect(await openHomeContract(delivery.rawToken, opened.contractId)).toMatchObject({ ok: true });
    expect(await loadHomeContractSections(delivery.rawToken, opened.contractId, 50)).toMatchObject({ ok: true, page: { offset: 50 } });

    expect((await terminateContractCore(owner, { id: opened.contractId })).ok).toBe(true);
    await ownerQuery(`update public.boqs set status = 'superseded' where id = $1`, [opened.boqId]);
    const reissued = await seedExecutionContract(orgId, { state: 'issued', delivery, linesPerSection: fiftyFive });

    expect(await loadHomeContractSections(delivery.rawToken, opened.contractId, 50)).toEqual({ ok: false, error: 'gone' });
    expect(await loadHomeContractSectionLines(delivery.rawToken, opened.contractId, reissued.sectionIds[50], 0)).toEqual({ ok: false, error: 'gone' });
    expect(await loadHomeContractSectionLines(delivery.rawToken, opened.contractId, opened.sectionIds[50], 0)).toEqual({ ok: false, error: 'gone' });
    // The page read again names the new contract, and its document reads its own pages.
    expect(await loadHomeContractSections(delivery.rawToken, reissued.contractId, 50)).toMatchObject({ ok: true, page: { offset: 50, section_count: 55 } });
    expect(await loadHomeContractSectionLines(delivery.rawToken, reissued.contractId, reissued.sectionIds[50], 0)).toMatchObject({ ok: true });
  });
});
