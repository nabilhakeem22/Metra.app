// MORE CHARACTERIZATION of updateProjectCore, beside the file committed before the
// split (which is not edited): every value the core passes through, with a
// SECOND value. The first file edits one project for one client under one clock,
// so a statement that hard-coded any of the three passed it; here the project,
// the client and the clock are all different.
// Same recording double and conventions. Every scenario is green on the unsplit
// code and on the split code alike.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { createRecordingTx } from '@/test/recording-tx';

vi.mock('server-only', () => ({}));
const db = createRecordingTx();
vi.mock('@/lib/db/context', () => ({
  withOrgContext: async (ctx: unknown, fn: (tx: unknown) => unknown, options: unknown) => {
    db.journal.push('begin ' + db.render([ctx, options]));
    try {
      return await fn(db.tx);
    } finally {
      db.journal.push('end');
    }
  },
}));
vi.mock('@/lib/audit', () => ({
  recordAudit: async (_tx: unknown, entry: unknown) => {
    db.journal.push('audit ' + db.render(entry));
  },
}));

const { updateProjectCore } = await import('./update');

// None of these is an id the first file uses.
const SECOND_PROJECT = '88888888-8888-4888-8888-888888888888';
const SECOND_CLIENT = '99999999-9999-4999-8999-999999999999';
const OLD_CLIENT = '33333333-3333-4333-8333-333333333333';
const ANOTHER_ROW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// The statements, exactly as the unsplit core issues them for the second project.
const BEGIN = 'begin [{orgId: "o-1", userId: "u-1", role: "owner"}, {write: true, capTransaction: undefined}]';
const READ_PROJECT =
  'select({id: projects.id, clientId: projects.client_id}).from(table:projects).where(sql("projects"."id" = $1 ["88888888-8888-4888-8888-888888888888"])).limit(1)';
const READ_OTHER_HOLDER_OF_CODE =
  'select({id: projects.id}).from(table:projects).where(sql(("projects"."code" = $1 and "projects"."id" <> $2) ["PRJ-9","88888888-8888-4888-8888-888888888888"])).limit(1)';
const READ_CLIENT =
  'select({id: clients.id, active: clients.active}).from(table:clients).where(sql("clients"."id" = $1 ["99999999-9999-4999-8999-999999999999"])).limit(1)';
const UPDATE_AT_THE_SECOND_CLOCK =
  'update(table:projects).set({code: "PRJ-9", nameEn: "Tower", nameAr: null, clientId: "99999999-9999-4999-8999-999999999999", typeId: null, startDate: null, endDate: null, description: null, city: null, country: null, address: null, notes: null, status: "active", updatedAt: Date(2027-06-15T08:30:00.000Z)}).where(sql("projects"."id" = $1 ["88888888-8888-4888-8888-888888888888"]))';
const UPDATE_AT_THE_FIRST_CLOCK =
  'update(table:projects).set({code: "PRJ-9", nameEn: "Tower", nameAr: null, clientId: "99999999-9999-4999-8999-999999999999", typeId: null, startDate: null, endDate: null, description: null, city: null, country: null, address: null, notes: null, status: "active", updatedAt: Date(2026-11-14T10:00:00.000Z)}).where(sql("projects"."id" = $1 ["88888888-8888-4888-8888-888888888888"]))';
const AUDIT_UPDATED =
  'audit {entity: "project", entityId: "88888888-8888-4888-8888-888888888888", action: "update", before: null, after: {code: "PRJ-9", client_id: "99999999-9999-4999-8999-999999999999", status: "active"}}';

const UP_TO_THE_CODE_CHECK = [BEGIN, READ_PROJECT, READ_OTHER_HOLDER_OF_CODE];

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };

const edit = { id: SECOND_PROJECT, code: 'PRJ-9', nameEn: 'Tower', clientId: SECOND_CLIENT, status: 'active' as const };
/** The project as stored, still with the client the edit names. */
const same = [{ id: SECOND_PROJECT, clientId: SECOND_CLIENT }];
/** The project as stored, with ANOTHER client: the edit reassigns it. */
const moved = [{ id: SECOND_PROJECT, clientId: OLD_CLIENT }];
const updated = { ok: true, data: undefined };

let log: ReturnType<typeof vi.spyOn>;

/** The journal, that every scripted result was consumed, and how many lines were logged. */
function expectTrace(journal: string[], logged: number): void {
  expect(db.journal).toEqual(journal);
  expect(db.pending()).toBe(0);
  expect(log).toHaveBeenCalledTimes(logged);
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'));
});
beforeEach(() => {
  db.reset();
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => log.mockRestore());
afterAll(() => vi.useRealTimers());

describe('updateProjectCore, a second project, client and clock', () => {
  it('U18 the project id, the new client and the time of the write are the ones this call was made with', async () => {
    vi.setSystemTime(new Date('2027-06-15T08:30:00.000Z'));
    try {
      db.respond(moved, [], [{ id: SECOND_CLIENT, active: true }], []);
      expect(await updateProjectCore(owner, edit)).toEqual(updated);
    } finally {
      vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'));
    }
    expectTrace([...UP_TO_THE_CODE_CHECK, READ_CLIENT, UPDATE_AT_THE_SECOND_CLOCK, AUDIT_UPDATED, 'end'], 0);
  });

  it('U19 every statement carries the id the CALLER sent, not the id of the row that was read', async () => {
    // A database answers the row it was asked for; the double can answer another,
    // which is the only way to tell the caller's id from one read back.
    db.respond([{ id: ANOTHER_ROW, clientId: SECOND_CLIENT }], [], []);
    expect(await updateProjectCore(owner, edit)).toEqual(updated);
    expectTrace([...UP_TO_THE_CODE_CHECK, UPDATE_AT_THE_FIRST_CLOCK, AUDIT_UPDATED, 'end'], 0);
  });

  it('U20 with the same client the second project is written at the first clock, the client not read', async () => {
    db.respond(same, [], []);
    expect(await updateProjectCore(owner, edit)).toEqual(updated);
    expectTrace([...UP_TO_THE_CODE_CHECK, UPDATE_AT_THE_FIRST_CLOCK, AUDIT_UPDATED, 'end'], 0);
  });
});
