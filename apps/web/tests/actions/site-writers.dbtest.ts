import { randomUUID } from 'node:crypto';
import type { MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appQuery, closeExecutionFixture, ownerQuery, seedClientProject, sqlstate } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';
import {
  appInsert,
  materialRow,
  noteRow,
  ownerInsert,
  photoRow,
  seedAssignment,
  seedMember,
  visitRow,
} from './site-fixture';

// Site diary DB step S: WHO may write, at the database, for a writer that
// skips the core's own check (the S2 security test's repros, S1 to S3, each one
// kept here). Every statement runs as metra_app in the named member's org
// context. A restrictive INSERT refusal is 42501; a restrictive UPDATE policy
// hides the row, so the update touches 0 rows; a guard refusal is MT100.

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let projectId: string;
let otherProjectId: string;
/** The studio's members, by the part they play here. */
const who: Record<'pm' | 'e1' | 'e2' | 'e3' | 'accountant' | 'viewer' | 'client', string> = {
  pm: '',
  e1: '',
  e2: '',
  e3: '',
  accountant: '',
  viewer: '',
  client: '',
};
let revokedAssignmentId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  orgIds.push(orgId);
  ({ projectId } = await seedClientProject(orgId));
  ({ projectId: otherProjectId } = await seedClientProject(orgId));
  const roles: Record<keyof typeof who, MemberRole> = {
    pm: 'project_manager',
    e1: 'site_engineer',
    e2: 'site_engineer',
    e3: 'site_engineer',
    accountant: 'accountant',
    viewer: 'viewer',
    client: 'client',
  };
  for (const [part, role] of Object.entries(roles) as Array<[keyof typeof who, MemberRole]>) {
    who[part] = await seedMember(orgId, role);
  }
  await seedAssignment(orgId, projectId, who.e1, ownerId);
  revokedAssignmentId = await seedAssignment(orgId, projectId, who.e3, ownerId);
  await ownerQuery(`update public.project_assignments set revoked_at = now(), revoked_by = $2 where id = $1`, [
    revokedAssignmentId,
    ownerId,
  ]);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const as = (userId: string, text: string, params: unknown[] = []) => appQuery<{ id: string }>(orgId, userId, text, params);
/** How many rows an UPDATE ... RETURNING id touched as `userId`. */
const touched = async (userId: string, text: string, params: unknown[] = []) => (await as(userId, `${text} returning id`, params)).length;
const NOT_MANAGERS = ['e1', 'e2', 'e3', 'accountant', 'viewer', 'client'] as const;
const NOT_WRITERS = ['e2', 'e3', 'accountant', 'viewer', 'client'] as const;

describe('project_assignments: only a manager assigns or revokes (S2 security S1)', () => {
  const assign = (userId: string, engineerId: string, assignedBy: string, project = otherProjectId) =>
    appInsert(orgId, userId, 'project_assignments', {
      org_id: orgId,
      project_id: project,
      user_id: engineerId,
      assigned_by: assignedBy,
    });

  it('refuses a non-manager assigning anyone, himself included (42501)', async () => {
    for (const part of NOT_MANAGERS) {
      expect(await sqlstate(assign(who[part], who[part], who[part])), `${part} self-assigns`).toBe('42501');
    }
    expect(await sqlstate(assign(who.viewer, who.e2, ownerId)), 'the viewer assigns E2 as the owner').toBe('42501');
  });

  it('lets owner and project manager assign, stamped with themselves, and refuses a forged assigner (42501)', async () => {
    const [first, second, third] = [
      await seedMember(orgId, 'site_engineer'),
      await seedMember(orgId, 'site_engineer'),
      await seedMember(orgId, 'site_engineer'),
    ];
    await expect(assign(ownerId, first, ownerId)).resolves.toBeDefined();
    await expect(assign(who.pm, second, who.pm)).resolves.toBeDefined();
    expect(await sqlstate(assign(ownerId, third, who.pm))).toBe('42501');
  });

  it('lets no non-manager un-revoke, revoke or rewrite an assignment (0 rows)', async () => {
    expect(
      await touched(who.e3, `update public.project_assignments set revoked_at = null, revoked_by = null where id = $1`, [revokedAssignmentId]),
    ).toBe(0);
    for (const part of NOT_MANAGERS) {
      expect(
        await touched(who[part], `update public.project_assignments set assigned_by = $1 where user_id = $2`, [who[part], who.e1]),
        part,
      ).toBe(0);
    }
  });

  it('keeps a revoke final, even for the owner (MT100): a re-assignment is a new row', async () => {
    expect(
      await sqlstate(as(ownerId, `update public.project_assignments set revoked_at = null, revoked_by = null where id = $1`, [revokedAssignmentId])),
    ).toBe('MT100');
    expect(
      await sqlstate(as(ownerId, `update public.project_assignments set revoked_by = $2 where id = $1`, [revokedAssignmentId, who.pm])),
    ).toBe('MT100');
  });

  it("stamps a revoke with the manager who makes it, never someone else's name (MT100)", async () => {
    const id = await seedAssignment(orgId, otherProjectId, await seedMember(orgId, 'site_engineer'), ownerId);
    expect(
      await sqlstate(as(ownerId, `update public.project_assignments set revoked_at = now(), revoked_by = $2 where id = $1`, [id, who.pm])),
    ).toBe('MT100');
    expect(await touched(who.pm, `update public.project_assignments set revoked_at = now(), revoked_by = $2 where id = $1`, [id, who.pm])).toBe(1);
  });
});

describe('site_devices: a revoke is final (S2 security S1)', () => {
  it("refuses the engineer un-revoking his own revoked phone, and a revoke in someone else's name (MT100)", async () => {
    const revoked = await ownerInsert('site_devices', {
      org_id: orgId,
      user_id: who.e1,
      auth_session_id: randomUUID(),
      label: 'Android',
      revoked_at: new Date().toISOString(),
      revoked_by: ownerId,
    });
    expect(
      await sqlstate(as(who.e1, `update public.site_devices set revoked_at = null, revoked_by = null where id = $1`, [revoked])),
    ).toBe('MT100');
    const live = await ownerInsert('site_devices', { org_id: orgId, user_id: who.e1, auth_session_id: randomUUID(), label: 'iPhone' });
    expect(
      await sqlstate(as(ownerId, `update public.site_devices set revoked_at = now(), revoked_by = $2 where id = $1`, [live, who.pm])),
    ).toBe('MT100');
    expect(await touched(ownerId, `update public.site_devices set revoked_at = now(), revoked_by = $2 where id = $1`, [live, ownerId])).toBe(1);
  });
});

describe('site_location_consents: only the person it is about records or withdraws it (S2 security S1)', () => {
  it("refuses a consent recorded for someone else (42501) and admits the engineer's own", async () => {
    expect(
      await sqlstate(appInsert(orgId, who.viewer, 'site_location_consents', { org_id: orgId, user_id: who.e2, policy_version: 1 })),
    ).toBe('42501');
    expect(
      await sqlstate(appInsert(orgId, ownerId, 'site_location_consents', { org_id: orgId, user_id: who.e2, policy_version: 1 })),
    ).toBe('42501');
    await expect(
      appInsert(orgId, who.e2, 'site_location_consents', { org_id: orgId, user_id: who.e2, policy_version: 1 }),
    ).resolves.toBeDefined();
  });

  it("lets nobody else withdraw it (0 rows), lets the engineer withdraw his own, and never hands it to another user", async () => {
    const consent = await ownerInsert('site_location_consents', { org_id: orgId, user_id: who.e1, policy_version: 1 });
    for (const userId of [who.accountant, ownerId]) {
      expect(await touched(userId, `update public.site_location_consents set withdrawn_at = now() where id = $1`, [consent])).toBe(0);
    }
    expect(await sqlstate(as(who.e1, `update public.site_location_consents set user_id = $2 where id = $1`, [consent, who.e2]))).toBe('42501');
    expect(await touched(who.e1, `update public.site_location_consents set withdrawn_at = now() where id = $1`, [consent])).toBe(1);
  });
});

describe('the diary tables: who may update at all (S2 security S2, fence 1)', () => {
  let visitId: string;
  let photoId: string;
  let materialId: string;
  let noteId: string;

  beforeAll(async () => {
    visitId = await ownerInsert('site_visits', visitRow(orgId, projectId, who.e1));
    photoId = await ownerInsert('site_photos', photoRow(orgId, projectId, visitId, who.e1, { status: 'stored' }));
    materialId = await ownerInsert('site_material_receipts', materialRow(orgId, projectId, visitId, who.e1));
    noteId = await ownerInsert('site_notes', noteRow(orgId, projectId, visitId, who.e1));
  });

  it('lets a viewer, an accountant, the client role and an unassigned or revoked engineer update NOTHING (0 rows)', async () => {
    for (const part of NOT_WRITERS) {
      const userId = who[part];
      const statements: Array<[string, unknown[]]> = [
        [`update public.site_visits set published_at = now(), published_by = $2, client_caption_en = 'defaced' where id = $1`, [visitId, userId]],
        [`update public.site_visits set checked_out_at = now() + interval '5 years' where id = $1`, [visitId]],
        [`update public.site_visits set lat = null, lng = null where id = $1`, [visitId]],
        [`update public.site_photos set client_visible = true where id = $1`, [photoId]],
        [`update public.site_photos set caption = 'lol' where id = $1`, [photoId]],
        [`update public.site_photos set voided_at = now(), voided_by = $2 where id = $1`, [photoId, userId]],
        [`update public.site_material_receipts set voided_at = now(), voided_by = $2 where id = $1`, [materialId, userId]],
        [`update public.site_notes set voided_at = now(), voided_by = $2 where id = $1`, [noteId, userId]],
      ];
      for (const [text, params] of statements) expect(await touched(userId, text, params), `${part}: ${text}`).toBe(0);
    }
  });

  it("lets the assigned engineer check out his own visit and void his own note, stamped with himself", async () => {
    expect(await touched(who.e1, `update public.site_visits set checked_out_at = now() where id = $1`, [visitId])).toBe(1);
    expect(
      await sqlstate(as(who.e1, `update public.site_notes set voided_at = now(), voided_by = $2 where id = $1`, [noteId, ownerId])),
    ).toBe('MT100');
    expect(await touched(who.e1, `update public.site_notes set voided_at = now(), voided_by = $2 where id = $1`, [noteId, who.e1])).toBe(1);
  });
});

describe('what the client sees is a manager decision (S2 security S2, fence 2)', () => {
  let visitId: string;
  let photoId: string;

  beforeAll(async () => {
    visitId = await ownerInsert('site_visits', visitRow(orgId, projectId, who.e1));
    photoId = await ownerInsert('site_photos', photoRow(orgId, projectId, visitId, who.e1, { status: 'stored' }));
  });

  it('refuses the assigned engineer publishing, captioning or showing anything to the client (MT100)', async () => {
    for (const [text, params] of [
      [`update public.site_visits set published_at = now(), published_by = $2 where id = $1`, [visitId, who.e1]],
      [`update public.site_visits set client_caption_ar = 'تم' where id = $1`, [visitId]],
      [`update public.site_photos set client_visible = true where id = $1`, [photoId]],
      [`update public.site_photos set caption = 'Kitchen' where id = $1`, [photoId]],
    ] as Array<[string, unknown[]]>) {
      expect(await sqlstate(as(who.e1, text, params)), text).toBe('MT100');
    }
  });

  it("refuses a publication or a void stamped in someone else's name, even by the owner (MT100)", async () => {
    expect(
      await sqlstate(as(ownerId, `update public.site_visits set published_at = now(), published_by = $2 where id = $1`, [visitId, who.pm])),
    ).toBe('MT100');
    expect(
      await sqlstate(as(ownerId, `update public.site_photos set voided_at = now(), voided_by = $2 where id = $1`, [photoId, who.e1])),
    ).toBe('MT100');
  });

  it('lets the project manager publish, caption and show, stamped with himself', async () => {
    expect(
      await touched(who.pm, `update public.site_visits set published_at = now(), published_by = $2, client_caption_en = 'Done' where id = $1`, [
        visitId,
        who.pm,
      ]),
    ).toBe(1);
    expect(await touched(who.pm, `update public.site_photos set client_visible = true, caption = 'Kitchen' where id = $1`, [photoId])).toBe(1);
    // A later re-caption by another manager keeps the first publisher's stamp.
    expect(await touched(ownerId, `update public.site_visits set client_caption_en = 'Tiling done' where id = $1`, [visitId])).toBe(1);
  });
});

describe('the site pin: a manager sets it; an assigned engineer only fills a missing one (S2 security S2, fence 3)', () => {
  const pin = (lat: string, setBy: string) => [lat, '31.235800', 2000, setBy] as unknown[];
  const setPin = `update public.projects set site_lat = $2, site_lng = $3, site_radius_m = $4, site_pin_set_by = $5, site_pin_set_at = now() where id = $1`;
  const clearPin = `update public.projects set site_lat = null, site_lng = null, site_radius_m = null, site_pin_set_by = null, site_pin_set_at = null where id = $1`;

  it('lets the assigned engineer set a MISSING pin, stamped with himself, and never move or clear it after (MT100)', async () => {
    const { projectId: fresh } = await seedClientProject(orgId);
    await seedAssignment(orgId, fresh, who.e1, ownerId);
    expect(await sqlstate(as(who.e1, setPin, [fresh, ...pin('30.044500', ownerId)])), 'credited to the owner').toBe('MT100');
    expect(await touched(who.e1, setPin, [fresh, ...pin('30.044500', who.e1)])).toBe(1);
    expect(await sqlstate(as(who.e1, setPin, [fresh, ...pin('30.050000', who.e1)])), 'moved').toBe('MT100');
    expect(await sqlstate(as(who.e1, clearPin, [fresh])), 'cleared').toBe('MT100');
  });

  it('refuses every other member setting or clearing a pin (MT100), and lets a manager move and clear it', async () => {
    for (const part of NOT_WRITERS) {
      expect(await sqlstate(as(who[part], setPin, [projectId, ...pin('30.044500', who[part])])), part).toBe('MT100');
    }
    expect(await touched(who.pm, setPin, [projectId, ...pin('30.044500', who.pm)])).toBe(1);
    expect(await touched(ownerId, setPin, [projectId, ...pin('30.050000', ownerId)])).toBe(1);
    expect(await sqlstate(as(who.accountant, clearPin, [projectId])), 'the accountant clears it').toBe('MT100');
    expect(await touched(ownerId, clearPin, [projectId])).toBe(1);
  });

  it("leaves every other project update alone: the accountant still edits a project's notes", async () => {
    expect(await touched(who.accountant, `update public.projects set notes = 'checked' where id = $1`, [projectId])).toBe(1);
  });
});

describe('an entry is filed under the current user only (S2 security S3)', () => {
  it("refuses the assigned engineer filing a visit, photo, delivery or note as someone else (42501)", async () => {
    expect(await sqlstate(appInsert(orgId, who.e1, 'site_visits', visitRow(orgId, projectId, who.e2))), 'visit as E2').toBe('42501');
    const visitId = await appInsert(orgId, who.e1, 'site_visits', visitRow(orgId, projectId, who.e1));
    for (const [table, row] of [
      ['site_photos', photoRow(orgId, projectId, visitId, ownerId)],
      ['site_material_receipts', materialRow(orgId, projectId, visitId, ownerId)],
      ['site_notes', noteRow(orgId, projectId, visitId, ownerId)],
    ] as const) {
      expect(await sqlstate(appInsert(orgId, who.e1, table, row)), `${table} as the owner`).toBe('42501');
      await expect(appInsert(orgId, who.e1, table, { ...row, ...authorOf(table, who.e1) })).resolves.toBeDefined();
    }
  });
});

/** The author column of a diary table, set to `userId`. */
function authorOf(table: 'site_photos' | 'site_material_receipts' | 'site_notes', userId: string): Record<string, string> {
  const column = { site_photos: 'uploaded_by', site_material_receipts: 'recorded_by', site_notes: 'author_id' }[table];
  return { [column]: userId };
}
