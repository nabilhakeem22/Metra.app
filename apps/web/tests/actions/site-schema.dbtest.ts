import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeExecutionFixture,
  ownerQuery,
  seedClientProject,
  seedExecutionContract,
  sqlstate,
} from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';
import {
  appInsert,
  materialRow,
  noteRow,
  ownerInsert,
  photoRow,
  seedAssignment,
  visitRow,
  type Row,
} from './site-fixture';

// Site diary DB step S (migration 0064 + apply-rls): the shape of the seven
// site tables and the projects site pin. CHECKs, partial uniques, and the
// 3-column same-project / same-contract FKs. Every write that stands for an app
// write runs as metra_app inside an owner's org context (the owner passes the
// restrictive insert policy on any project), so what is refused here is
// refused by the SCHEMA, not by a policy; a row about another person (a
// consent) is seeded over the owner connection, and so is a row metra_app may
// not insert at all (a device, which only its own session registers; a photo
// already stored or voided, which the insert guards refuse first, MT100). The
// guards, the grants and the policies are site-guards.dbtest.ts,
// site-writers.dbtest.ts and site-access.dbtest.ts.

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let otherOrgId: string;
let projectId: string;
let visitId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  const other = await seedOrg({ owners: 1 });
  otherOrgId = other.orgId;
  orgIds.push(orgId, otherOrgId);
  ({ projectId } = await seedClientProject(orgId));
  visitId = await ownerInsert('site_visits', visitRow(orgId, projectId, ownerId));
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const insert = (table: string, row: Row) => appInsert(orgId, ownerId, table, row);

/** The SQLSTATE and the constraint a statement was refused with. */
async function refusal(run: Promise<unknown>): Promise<{ code?: string; constraint_name?: string }> {
  return run.then(
    () => ({}),
    (caught: { code?: string; constraint_name?: string }) => ({
      code: caught.code,
      constraint_name: caught.constraint_name,
    }),
  );
}

describe('projects: the site pin (0064)', () => {
  const setPin = (fields: Row) => {
    const columns = Object.keys(fields);
    return ownerQuery(
      `update public.projects set ${columns.map((column, i) => `${column} = $${String(i + 2)}`).join(', ')} where id = $1`,
      [projectId, ...Object.values(fields)],
    );
  };
  const fullPin = { site_lat: '30.044400', site_lng: '31.235700', site_radius_m: 150 };

  it('is all five columns or none (projects_site_pin_shape)', async () => {
    expect(await refusal(setPin({ site_lat: '30.0444' }))).toMatchObject({
      code: '23514',
      constraint_name: 'projects_site_pin_shape',
    });
    await expect(
      setPin({ ...fullPin, site_pin_set_by: ownerId, site_pin_set_at: new Date().toISOString() }),
    ).resolves.toBeDefined();
    expect(await refusal(setPin({ site_pin_set_at: null }))).toMatchObject({
      constraint_name: 'projects_site_pin_shape',
    });
  });

  it('refuses a latitude past 90, a longitude past 180 and a radius outside 30..2000 (projects_site_pin_range)', async () => {
    for (const bad of [{ site_lat: '90.000001' }, { site_lng: '-180.5' }, { site_radius_m: 29 }, { site_radius_m: 2001 }]) {
      expect(await refusal(setPin(bad)), JSON.stringify(bad)).toMatchObject({
        code: '23514',
        constraint_name: 'projects_site_pin_range',
      });
    }
    await expect(setPin({ site_radius_m: 2000 })).resolves.toBeDefined();
  });
});

describe('project_assignments', () => {
  it('holds one LIVE row per (project, user); a revoked one leaves room for a new one', async () => {
    const userId = randomUUID();
    const first = await seedAssignment(orgId, projectId, userId, ownerId);
    expect(await refusal(seedAssignment(orgId, projectId, userId, ownerId))).toMatchObject({
      code: '23505',
      constraint_name: 'project_assignments_one_live',
    });
    await ownerQuery(`update public.project_assignments set revoked_at = now(), revoked_by = $2 where id = $1`, [
      first,
      ownerId,
    ]);
    await expect(seedAssignment(orgId, projectId, userId, ownerId)).resolves.toBeDefined();
  });

  it('stamps a revoke with who and when, both or neither (23514)', async () => {
    const id = await seedAssignment(orgId, projectId, randomUUID(), ownerId);
    expect(await refusal(ownerQuery(`update public.project_assignments set revoked_at = now() where id = $1`, [id]))).toMatchObject({
      code: '23514',
      constraint_name: 'project_assignments_revoke_pair',
    });
  });

  it("refuses another studio's project (the same-org FK, 23503)", async () => {
    const foreign = await seedClientProject(otherOrgId);
    expect(await sqlstate(seedAssignment(orgId, foreign.projectId, randomUUID(), ownerId))).toBe('23503');
  });
});

describe('site_location_consents and site_devices', () => {
  it('holds one live consent per user, and a version above 0', async () => {
    const userId = randomUUID();
    const consent = (fields: Row) => ownerInsert('site_location_consents', { org_id: orgId, ...fields });
    await consent({ user_id: userId, policy_version: 1 });
    expect(await refusal(consent({ user_id: userId, policy_version: 1 }))).toMatchObject({
      code: '23505',
      constraint_name: 'site_location_consents_one_live',
    });
    expect(await refusal(consent({ user_id: randomUUID(), policy_version: 0 }))).toMatchObject({
      code: '23514',
      constraint_name: 'site_location_consents_policy_version_positive',
    });
  });

  it('holds one device row per (studio, auth session) with a 1..80 character label', async () => {
    const sessionId = randomUUID();
    const device = (fields: Row) =>
      ownerInsert('site_devices', { org_id: orgId, user_id: ownerId, auth_session_id: randomUUID(), label: 'Android · Chrome', ...fields });
    await device({ auth_session_id: sessionId });
    expect(await refusal(device({ auth_session_id: sessionId }))).toMatchObject({
      code: '23505',
      constraint_name: 'site_devices_org_session_unique',
    });
    for (const label of ['', 'x'.repeat(81)]) {
      expect(await refusal(device({ label }))).toMatchObject({ code: '23514', constraint_name: 'site_devices_label_length' });
    }
    expect(await refusal(device({ revoked_at: new Date().toISOString() }))).toMatchObject({
      constraint_name: 'site_devices_revoke_pair',
    });
  });
});

describe('site_visits', () => {
  const visit = (fields: Row) => insert('site_visits', visitRow(orgId, projectId, ownerId, fields));
  const fixed = { location_status: 'fixed', lat: '30.044400', lng: '31.235700', accuracy_m: 20, presence: 'on_site', distance_m: 120 };

  it('stores a fixed on-site reading and a no-location check-in with its reason', async () => {
    await expect(visit(fixed)).resolves.toBeDefined();
    await expect(visit({ no_location_reason: 'Basement, no signal' })).resolves.toBeDefined();
  });

  it('refuses a check-out before the check-in (site_visits_checkout_order)', async () => {
    expect(await refusal(visit({ checked_out_at: '2026-10-24T07:29:59Z' }))).toMatchObject({
      code: '23514',
      constraint_name: 'site_visits_checkout_order',
    });
  });

  it('ties a reading to its accuracy and keeps coordinates paired and on readings only (site_visits_fix_shape)', async () => {
    for (const bad of [
      { ...fixed, accuracy_m: null },
      { ...fixed, lng: null },
      { lat: '30.0444', lng: '31.2357' },
      { accuracy_m: 20 },
    ]) {
      expect(await refusal(visit(bad)), JSON.stringify(bad)).toMatchObject({
        code: '23514',
        constraint_name: 'site_visits_fix_shape',
      });
    }
    // The 90-day purge shape: still `fixed`, still an accuracy, no coordinates.
    await expect(visit({ ...fixed, lat: null, lng: null })).resolves.toBeDefined();
  });

  it('refuses a latitude of 91 and an accuracy over 100 km (site_visits_coordinates_range)', async () => {
    for (const bad of [{ ...fixed, lat: '91' }, { ...fixed, lng: '181' }, { ...fixed, accuracy_m: 100_001 }, { ...fixed, accuracy_m: -1 }]) {
      expect(await refusal(visit(bad)), JSON.stringify(bad)).toMatchObject({
        code: '23514',
        constraint_name: 'site_visits_coordinates_range',
      });
    }
  });

  it('keeps the verdict consistent with the reading (site_visits_verdict_shape)', async () => {
    for (const bad of [
      { ...fixed, distance_m: null },
      { ...fixed, presence: 'no_location', distance_m: null },
      { ...fixed, distance_m: -1 },
      { presence: 'on_site', distance_m: 10 },
      { distance_m: 10 },
    ]) {
      expect(await refusal(visit(bad)), JSON.stringify(bad)).toMatchObject({
        code: '23514',
        constraint_name: 'site_visits_verdict_shape',
      });
    }
    // No pin: a reading and no reading both answer no_site_pin, with no distance.
    await expect(visit({ ...fixed, presence: 'no_site_pin', distance_m: null })).resolves.toBeDefined();
    await expect(visit({ presence: 'no_site_pin' })).resolves.toBeDefined();
  });

  it('bounds the reason to 200 and each caption to 500 characters, and pairs the publication', async () => {
    expect(await refusal(visit({ no_location_reason: 'x'.repeat(201) }))).toMatchObject({ constraint_name: 'site_visits_reason_length' });
    expect(await refusal(visit({ client_caption_ar: 'x'.repeat(501) }))).toMatchObject({ constraint_name: 'site_visits_caption_length' });
    expect(await refusal(visit({ published_at: new Date().toISOString() }))).toMatchObject({ constraint_name: 'site_visits_publish_pair' });
  });

  it('holds one visit per client key in a studio (the outbox replay key, 23505)', async () => {
    const clientKey = randomUUID();
    await visit({ client_key: clientKey });
    expect(await refusal(visit({ client_key: clientKey }))).toMatchObject({
      code: '23505',
      constraint_name: 'site_visits_org_client_key_unique',
    });
    const [replay] = await ownerQuery<{ n: number }>(
      `with attempt as (
         insert into public.site_visits (org_id, project_id, user_id, client_key, visit_date, checked_in_at, location_status, presence)
         values ($1, $2, $3, $4, '2026-10-24', now(), 'declined', 'no_location')
         on conflict (org_id, client_key) do nothing returning id)
       select (select count(*) from attempt)::int as n`,
      [orgId, projectId, ownerId, clientKey],
    );
    expect(replay.n).toBe(0);
  });
});

describe('site_photos', () => {
  const photo = (fields: Row = {}) => insert('site_photos', photoRow(orgId, projectId, visitId, ownerId, fields));

  it('stores a pending camera photo', async () => {
    await expect(photo()).resolves.toBeDefined();
  });

  it('stores NO object key: no key column, no key CHECK, no key index (S2 reliability R1)', async () => {
    const [shape] = await ownerQuery<{ key_columns: number; key_constraints: number; key_indexes: number }>(
      `select (select count(*) from information_schema.columns
                where table_schema = 'public' and table_name = 'site_photos' and column_name like '%key%' and column_name <> 'client_key')::int as key_columns,
              (select count(*) from pg_constraint where conrelid = 'public.site_photos'::regclass
                and conname in ('site_photos_keys_derived', 'site_photos_display_key_unique'))::int as key_constraints,
              (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'site_photos'
                and indexdef ilike '%display%')::int as key_indexes`,
    );
    expect(shape).toEqual({ key_columns: 0, key_constraints: 0, key_indexes: 0 });
  });

  it('bounds the bytes, the dimensions, the type, the provider and the caption', async () => {
    const cases: Array<[Row, string]> = [
      [{ display_bytes: 0 }, 'site_photos_display_bytes_range'],
      [{ display_bytes: 1_048_577 }, 'site_photos_display_bytes_range'],
      [{ thumb_bytes: 131_073 }, 'site_photos_thumb_bytes_range'],
      [{ width: 4097 }, 'site_photos_dimensions_range'],
      [{ height: 0 }, 'site_photos_dimensions_range'],
      [{ content_type: 'image/png' }, 'site_photos_content_type'],
      [{ storage_provider: 's3' }, 'site_photos_storage_provider'],
      [{ caption: 'x'.repeat(301) }, 'site_photos_caption_length'],
    ];
    for (const [fields, constraint] of cases) {
      expect(await refusal(photo(fields)), constraint).toMatchObject({ code: '23514', constraint_name: constraint });
    }
    await expect(photo({ display_bytes: 1_048_576, thumb_bytes: 131_072, width: 4096, height: 4096 })).resolves.toBeDefined();
  });

  it('shows the client only a stored photo that is not void', async () => {
    expect(await refusal(photo({ client_visible: true }))).toMatchObject({ constraint_name: 'site_photos_visible_is_stored' });
    const ownerPhoto = (fields: Row) => ownerInsert('site_photos', photoRow(orgId, projectId, visitId, ownerId, fields));
    expect(
      await refusal(ownerPhoto({ client_visible: true, status: 'stored', voided_at: new Date().toISOString(), voided_by: ownerId })),
    ).toMatchObject({ constraint_name: 'site_photos_visible_not_void' });
    expect(await refusal(ownerPhoto({ voided_at: new Date().toISOString() }))).toMatchObject({ constraint_name: 'site_photos_void_pair' });
  });

  it('names only a visit of its OWN project (the 3-column FK, 23503)', async () => {
    const sibling = await seedClientProject(orgId);
    const siblingVisit = await ownerInsert('site_visits', visitRow(orgId, sibling.projectId, ownerId));
    expect(await refusal(photo({ visit_id: siblingVisit }))).toMatchObject({
      code: '23503',
      constraint_name: 'site_photos_visit_same_project_fk',
    });
  });
});

describe('site_material_receipts', () => {
  const material = (fields: Row = {}) => insert('site_material_receipts', materialRow(orgId, projectId, visitId, ownerId, fields));

  it('stores a delivery with and without a contract line of its own project', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [2] });
    const visitOnContractProject = await ownerInsert('site_visits', visitRow(orgId, contract.projectId, ownerId));
    await expect(material()).resolves.toBeDefined();
    await expect(
      insert(
        'site_material_receipts',
        materialRow(orgId, contract.projectId, visitOnContractProject, ownerId, {
          contract_id: contract.contractId,
          contract_line_id: contract.lineIds[0][0],
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("refuses a line of another project's contract (AC28: the same-project FK, 23503)", async () => {
    const theirs = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [1] });
    expect(await refusal(material({ contract_id: theirs.contractId, contract_line_id: theirs.lineIds[0][0] }))).toMatchObject({
      code: '23503',
      constraint_name: 'site_material_receipts_contract_same_project_fk',
    });
  });

  it('refuses a contract of its own project paired with a line of ANOTHER contract (the same-contract FK, 23503)', async () => {
    const first = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [1] });
    const second = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [1] });
    const visitOnFirst = await ownerInsert('site_visits', visitRow(orgId, first.projectId, ownerId));
    expect(
      await refusal(
        insert(
          'site_material_receipts',
          materialRow(orgId, first.projectId, visitOnFirst, ownerId, {
            contract_id: first.contractId,
            contract_line_id: second.lineIds[0][0],
          }),
        ),
      ),
    ).toMatchObject({ code: '23503', constraint_name: 'site_material_receipts_contractLine_same_contract_fk' });
  });

  it('refuses a contract without its line, or a line without its contract (site_material_receipts_contract_pair)', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [1] });
    for (const bad of [{ contract_id: contract.contractId }, { contract_line_id: contract.lineIds[0][0] }]) {
      expect(await refusal(material(bad))).toMatchObject({ code: '23514', constraint_name: 'site_material_receipts_contract_pair' });
    }
  });

  it("names only a photo of its OWN project (Sec-S6: the 3-column photo FK, 23503)", async () => {
    const sibling = await seedClientProject(orgId);
    const siblingVisit = await ownerInsert('site_visits', visitRow(orgId, sibling.projectId, ownerId));
    const siblingPhoto = await ownerInsert('site_photos', photoRow(orgId, sibling.projectId, siblingVisit, ownerId));
    const ownPhoto = await ownerInsert('site_photos', photoRow(orgId, projectId, visitId, ownerId));
    expect(await refusal(material({ photo_id: siblingPhoto }))).toMatchObject({
      code: '23503',
      constraint_name: 'site_material_receipts_photo_same_project_fk',
    });
    await expect(material({ photo_id: ownPhoto })).resolves.toBeDefined();
  });

  it('refuses a blank, whitespace-only or 201-character description, and a zero or NaN quantity', async () => {
    for (const description of ['', ' \t\n', ' ​', 'x'.repeat(201)]) {
      expect(await refusal(material({ description })), JSON.stringify(description)).toMatchObject({
        constraint_name: 'site_material_receipts_description_present',
      });
    }
    for (const qty of ['0', '-1', 'NaN']) {
      expect(await refusal(material({ qty }))).toMatchObject({ constraint_name: 'site_material_receipts_qty_positive' });
    }
    expect(await refusal(material({ supplier: 'x'.repeat(121) }))).toMatchObject({ constraint_name: 'site_material_receipts_text_length' });
    expect(await refusal(material({ note: 'x'.repeat(301) }))).toMatchObject({ constraint_name: 'site_material_receipts_text_length' });
    expect(await sqlstate(material({ unit: 'sack' }))).toBe('22P02');
  });

  it('narrows its one set-null FK to photo_id, never org_id or project_id (the 0052 rule)', async () => {
    const [fk] = await ownerQuery<{ columns: string[]; nulled: string[] }>(
      `select array(select a.attname::text from unnest(c.conkey) with ordinality as k(n, o)
                     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o) as columns,
              array(select a.attname::text from unnest(c.confdelsetcols) as k(n)
                     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) as nulled
         from pg_constraint c where c.conname = 'site_material_receipts_photo_same_project_fk'`,
    );
    expect(fk).toEqual({ columns: ['org_id', 'project_id', 'photo_id'], nulled: ['photo_id'] });
  });
});

describe('site_notes', () => {
  const note = (fields: Row = {}) => insert('site_notes', noteRow(orgId, projectId, visitId, ownerId, fields));

  it('stores the three kinds and refuses any other (22P02)', async () => {
    for (const kind of ['progress', 'issue', 'request']) await expect(note({ kind })).resolves.toBeDefined();
    expect(await sqlstate(note({ kind: 'complaint' }))).toBe('22P02');
  });

  it('refuses a blank or 2001-character body (site_notes_body_present)', async () => {
    for (const body of ['', '   ', 'x'.repeat(2001)]) {
      expect(await refusal(note({ body }))).toMatchObject({ code: '23514', constraint_name: 'site_notes_body_present' });
    }
    await expect(note({ body: 'x'.repeat(2000) })).resolves.toBeDefined();
  });
});

describe('"present" text refuses an entry of invisible characters only (S2 functional F4)', () => {
  /** What an Arabic keyboard or a paste can produce that reads as empty: bidi marks, joiners, fillers. */
  const INVISIBLE = {
    RLM: 0x200f,
    LRM: 0x200e,
    ALM: 0x061c,
    ZWJ: 0x200d,
    ZWNJ: 0x200c,
    WJ: 0x2060,
    'soft hyphen': 0x00ad,
    tatweel: 0x0640,
    NEL: 0x0085,
    MVS: 0x180e,
    RLE: 0x202b,
    RLI: 0x2067,
    CGJ: 0x034f,
  };
  const only = (codePoint: number) => String.fromCodePoint(codePoint).repeat(3);
  const material = (description: string) =>
    insert('site_material_receipts', materialRow(orgId, projectId, visitId, ownerId, { description }));
  const note = (body: string) => insert('site_notes', noteRow(orgId, projectId, visitId, ownerId, { body }));

  it('on a delivery description and a note body (23514), with every character named', async () => {
    for (const [name, codePoint] of Object.entries(INVISIBLE)) {
      expect(await refusal(material(only(codePoint))), name).toMatchObject({
        code: '23514',
        constraint_name: 'site_material_receipts_description_present',
      });
      expect(await refusal(note(only(codePoint))), name).toMatchObject({ code: '23514', constraint_name: 'site_notes_body_present' });
    }
    const mixed = Object.values(INVISIBLE).map((codePoint) => String.fromCodePoint(codePoint)).join(' ');
    expect(await refusal(material(mixed))).toMatchObject({ constraint_name: 'site_material_receipts_description_present' });
  });

  it('still takes a real Arabic or English entry that carries a bidi mark', async () => {
    const rlm = String.fromCodePoint(INVISIBLE.RLM);
    await expect(material(`${rlm}أسمنت${rlm}`)).resolves.toBeDefined();
    await expect(note(`${rlm}Tiling 50%${rlm}`)).resolves.toBeDefined();
  });

  it('is ONE shared helper in the database, a pure function both CHECKs call', async () => {
    const [helper] = await ownerQuery<{ volatile: string; checks: number }>(
      `select p.provolatile as volatile,
              (select count(*) from pg_constraint c
                where c.conname in ('site_material_receipts_description_present', 'site_notes_body_present')
                  and pg_get_constraintdef(c.oid) like '%text_has_visible_character%')::int as checks
         from pg_proc p where p.oid = 'public.text_has_visible_character(text)'::regprocedure`,
    );
    expect(helper).toEqual({ volatile: 'i', checks: 2 });
  });
});
