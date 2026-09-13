import { is } from 'drizzle-orm';
import { getTableConfig, PgTable, pgTable, unique } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './index';
import { money } from './_helpers';
import { auditLog } from './audit-log';
import { clients } from './clients';
import { contracts } from './contracts';
import { costItems } from './cost-items';
import { engagementEvents } from './engagement-events';
import { MEMBER_ROLES } from './enums';
import { files } from './files';
import { memberships } from './memberships';
import { orgScoped } from './org-scoped';
import { sameOrgFk, sameOrgRef } from './org-ref';
import { organizations } from './organizations';
import { projects } from './projects';
import { proposals } from './proposals';

// drizzle 0.36 does not export the shape of an index column; this is the slice
// the assertions read — .desc() lands in indexConfig.order.
interface IndexColumn {
  name?: string;
  indexConfig?: { order?: 'asc' | 'desc' };
}

type IndexedTable = Parameters<typeof getTableConfig>[0];

function findIndex(table: IndexedTable, indexName: string) {
  const idx = getTableConfig(table).indexes.find(
    (i) => i.config.name === indexName,
  );
  if (!idx) {
    throw new Error(`index ${indexName} is not declared in the schema`);
  }
  return idx;
}

const indexColumnsOf = (idx: ReturnType<typeof findIndex>) =>
  idx.config.columns as IndexColumn[];
const columnNamesOf = (idx: ReturnType<typeof findIndex>) =>
  indexColumnsOf(idx).map((c) => c.name);
const directionsOf = (idx: ReturnType<typeof findIndex>) =>
  indexColumnsOf(idx).map((c) => c.indexConfig?.order);

describe('bilingual helper', () => {
  it('emits _ar and _en columns', () => {
    const cfg = getTableConfig(organizations);
    const names = cfg.columns.map((c) => c.name);
    expect(names).toContain('name_ar');
    expect(names).toContain('name_en');
  });

  it('emits an "at least one non-null" check constraint', () => {
    const cfg = getTableConfig(organizations);
    const check = cfg.checks.find((c) => c.name === 'organizations_name_present');
    expect(check).toBeDefined();
  });
});

describe('money helper', () => {
  it('is numeric(18, 4), carried as string', () => {
    const t = pgTable('t_money', { amount: money('amount') });
    const cfg = getTableConfig(t);
    const col = cfg.columns.find((c) => c.name === 'amount')!;
    expect(col.getSQLType()).toBe('numeric(18, 4)');
    expect(col.dataType).toBe('string');
  });
});

describe('org-scoped mixin', () => {
  it.each([
    ['memberships', memberships],
    ['audit_log', auditLog],
    ['files', files],
  ])('%s carries org_id + unique(org_id, id)', (name, table) => {
    const cfg = getTableConfig(table as typeof memberships);
    const cols = cfg.columns.map((c) => c.name);
    expect(cols).toContain('org_id');
    expect(cols).toContain('id');
    const composite = cfg.uniqueConstraints.find(
      (u) => u.name === `${name}_org_id_id_unique`,
    );
    expect(composite).toBeDefined();
    expect(composite!.columns.map((c) => c.name).sort()).toEqual(['id', 'org_id']);
  });
});

describe('composite same-org FK helper (org-ref)', () => {
  const parent = pgTable('cfk_parent', { ...orgScoped() }, (t) => [
    unique('cfk_parent_org_id_id_unique').on(t.orgId, t.id),
  ]);
  const child = pgTable(
    'cfk_child',
    { ...orgScoped(), ...sameOrgRef('parent') },
    (t) => [
      unique('cfk_child_org_id_id_unique').on(t.orgId, t.id),
      ...sameOrgFk(t, 'parent', parent),
    ],
  );

  it('sameOrgRef adds a <name>_id column', () => {
    const cols = getTableConfig(child).columns.map((c) => c.name);
    expect(cols).toContain('parent_id');
  });

  it('sameOrgFk builds the composite (org_id,<name>_id) -> (org_id,id) FK', () => {
    const cfg = getTableConfig(child);
    const fk = cfg.foreignKeys.find(
      (f) => f.getName() === 'cfk_child_parent_same_org_fk',
    );
    expect(fk).toBeDefined();
    const ref = fk!.reference();
    expect(ref.columns.map((c) => c.name)).toEqual(['org_id', 'parent_id']);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(['org_id', 'id']);
  });

  it('sameOrgFk ships an (org_id,<name>_id) index leading with org_id', () => {
    const cfg = getTableConfig(child);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'cfk_child_parent_idx',
    );
    expect(idx).toBeDefined();
    expect(
      idx!.config.columns.map((c) => (c as { name?: string }).name),
    ).toEqual(['org_id', 'parent_id']);
  });
});

describe('member_role enum', () => {
  it('matches §2.1 order exactly', () => {
    expect([...MEMBER_ROLES]).toEqual([
      'owner',
      'admin',
      'project_manager',
      'site_engineer',
      'accountant',
      'client',
      'viewer',
    ]);
  });
});

// tax_rate multiplies the whole taxable base, and until 0044 it was the only
// percentage column in the schema with no [0,100] CHECK.
describe('tax_rate range checks (0044)', () => {
  it.each([
    ['proposals', proposals, 'proposals_tax_rate_range'],
    ['contracts', contracts, 'contracts_tax_rate_range'],
  ])('%s carries %s', (_name, table, constraint) => {
    const cfg = getTableConfig(table as typeof proposals);
    expect(cfg.checks.map((c) => c.name)).toContain(constraint);
  });
});

// Both tables are addressed by (org_id, entity, entity_id) and by nothing else;
// before 0045 neither had an index on it.
describe('polymorphic entity indexes (0045)', () => {
  it.each([
    ['files', files, 'files_org_entity_idx', ['org_id', 'entity', 'entity_id']],
    [
      'audit_log',
      auditLog,
      'audit_log_org_entity_at_idx',
      ['org_id', 'entity', 'entity_id', 'at'],
    ],
  ])('%s carries %s', (_name, table, indexName, columns) => {
    expect(columnNamesOf(findIndex(table as typeof files, indexName))).toEqual(
      columns,
    );
  });
});

// Each of these lives in the database (0019, 0033, 0039, 0040, 0043) but was
// missing from the schema files, so the next `drizzle-kit generate` would have
// emitted a DROP INDEX for it. Column ORDER, SORT DIRECTION, uniqueness and the
// partial predicate are all pinned, not just the name: a keyset index only
// serves the scan while org_id leads it and the trailing columns descend the way
// the list endpoints page, and a partial UNIQUE stops being the same invariant
// the moment its WHERE clause moves.
const KEYSET_COLUMNS = ['org_id', 'created_at', 'id'];
const KEYSET_DIRECTIONS = ['asc', 'desc', 'desc'];

describe('indexes declared for what the database already has', () => {
  it.each([
    { table: clients, name: 'clients_org_created_id_idx' },
    { table: costItems, name: 'cost_items_org_created_id_idx' },
    { table: projects, name: 'projects_org_created_id_idx' },
    { table: proposals, name: 'proposals_org_created_id_idx' },
  ])('$name is the (org_id, created_at DESC, id DESC) keyset index', (spec) => {
    const idx = findIndex(spec.table, spec.name);
    expect(columnNamesOf(idx)).toEqual(KEYSET_COLUMNS);
    expect(directionsOf(idx)).toEqual(KEYSET_DIRECTIONS);
    expect(idx.config.unique).toBe(false);
  });

  it.each([
    {
      table: files,
      name: 'files_org_category_idx',
      columns: ['org_id', 'category_id'],
      unique: false,
    },
    {
      table: projects,
      name: 'projects_org_number_unique',
      columns: ['org_id', 'number'],
      unique: true,
    },
    {
      table: engagementEvents,
      name: 'engagement_events_client_signal_unique',
      columns: ['engagement_id', 'kind'],
      unique: true,
    },
    {
      table: engagementEvents,
      name: 'engagement_events_supersedes_idx',
      columns: ['org_id', 'supersedes_event_id'],
      unique: false,
    },
  ])('$name stays PARTIAL over $columns', (spec) => {
    const idx = findIndex(spec.table, spec.name);
    expect(columnNamesOf(idx)).toEqual(spec.columns);
    expect(idx.config.unique).toBe(spec.unique);
    // Every one of these was created with a WHERE clause; without it the UNIQUE
    // ones would reject rows the database accepts today.
    expect(idx.config.where).toBeDefined();
  });
});

describe('every column in the schema is snake_case', () => {
  // THE TRAP THIS CATCHES: the column helpers derive a name from whatever string
  // they are handed, verbatim. sameOrgRef('settledByPaymentEvent') therefore
  // emits the column "settledByPaymentEvent_id", which tsc, lint and the schema
  // barrel all accept while every query against the real table fails at runtime
  // with `column ... does not exist`. This is a cheap, total check: it reads the
  // whole schema barrel, so a new table is covered the day it is added.
  const tables = Object.values(schema as Record<string, unknown>).filter(
    (value): value is IndexedTable => is(value, PgTable),
  );

  it('reads every table in the barrel', () => {
    expect(tables.length).toBeGreaterThan(30);
  });

  it.each(tables.map((table) => ({ name: getTableConfig(table).name, table })))(
    '$name',
    ({ table }) => {
      const offenders = getTableConfig(table)
        .columns.map((column) => column.name)
        .filter((name) => !/^[a-z][a-z0-9_]*$/.test(name));
      expect(offenders).toEqual([]);
    },
  );
});
