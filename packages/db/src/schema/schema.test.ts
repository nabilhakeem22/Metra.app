import { getTableConfig, pgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { money } from './_helpers';
import { auditLog } from './audit-log';
import { MEMBER_ROLES } from './enums';
import { files } from './files';
import { memberships } from './memberships';
import { organizations } from './organizations';

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
