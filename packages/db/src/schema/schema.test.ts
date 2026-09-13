import { getTableConfig, pgTable, unique } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { money } from './_helpers';
import { auditLog } from './audit-log';
import { contracts } from './contracts';
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
    const idx = getTableConfig(table as typeof files).indexes.find(
      (i) => i.config.name === indexName,
    );
    expect(idx).toBeDefined();
    expect(
      idx!.config.columns.map((c) => (c as { name?: string }).name),
    ).toEqual(columns);
  });
});

// These two exist in the database (0019, 0040) but were missing from the schema
// files, so the next `drizzle-kit generate` would have emitted a DROP INDEX for
// each. Column ORDER and SORT DIRECTION are both asserted, not just the name: a
// keyset index only serves the scan while org_id leads it AND the trailing
// columns descend the way the list endpoints page.
describe('indexes declared for what the database already has', () => {
  it.each([
    [
      'projects',
      projects,
      'projects_org_created_id_idx',
      ['org_id', 'created_at', 'id'],
      ['asc', 'desc', 'desc'],
    ],
    [
      'files',
      files,
      'files_org_category_idx',
      ['org_id', 'category_id'],
      ['asc', 'asc'],
    ],
  ])('%s carries %s', (_name, table, indexName, columns, directions) => {
    const idx = getTableConfig(table as typeof files).indexes.find(
      (i) => i.config.name === indexName,
    );
    expect(idx).toBeDefined();
    const indexColumns = idx!.config.columns as IndexColumn[];
    expect(indexColumns.map((c) => c.name)).toEqual(columns);
    expect(indexColumns.map((c) => c.indexConfig?.order)).toEqual(directions);
  });

  it('files_org_category_idx stays PARTIAL, as 0040 created it', () => {
    const idx = getTableConfig(files).indexes.find(
      (i) => i.config.name === 'files_org_category_idx',
    );
    expect(idx!.config.where).toBeDefined();
  });
});
