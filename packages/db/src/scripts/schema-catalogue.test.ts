import { describe, expect, it } from 'vitest';
import { RLS_APPLY_ORDER } from '../rls/manifest';
import {
  declaredConstraints,
  declaredFunctions,
  declaredIndexes,
  declaredTables,
  missingColumns,
  missingNames,
} from './schema-catalogue';

// `assert-schema-applied` is the instrument the squad has leaned on hardest, and
// until now it compared ONE kind of object (columns) while reporting that the
// database was "ready". These tests pin the three new readings, and - more
// importantly - pin the two properties that make the whole check trustworthy:
// it is ONE-DIRECTIONAL (an extra object in the database is never a gap), and a
// CASE-ONLY difference is reported as what it is rather than as "missing".
//
// No connection is opened here. Every `applied` set below is a fixture.

describe('what the code declares', () => {
  it('reads every table off the drizzle schema', () => {
    const tables = declaredTables();
    expect(tables.size).toBe(46);
    // A table picked because it is the one the 4th-TG_ARGV work turns on.
    expect(tables.get('boqs')?.has('source_file_id')).toBe(true);
    expect(tables.get('design_engagements')?.has('revision_count')).toBe(true);
  });

  it('reads index names off the same schema', () => {
    const indexes = declaredIndexes();
    expect(indexes.size).toBeGreaterThan(100);
    // 0049's index: the one delivery-respond.dbtest.ts asserts in the catalogue.
    expect(indexes.get('engagement_events_engagement_channel_kind_idx')).toBe(
      'engagement_events',
    );
  });

  it('reads CHECK, UNIQUE and foreign-key constraint names', () => {
    const constraints = declaredConstraints();
    // The universal composite-FK target every org-scoped table carries.
    expect(constraints.get('clients_org_id_id_unique')).toBe('clients');
    // A named CHECK.
    expect(constraints.has('accounts_name_present')).toBe(true);
    // A foreign key, named by drizzle's own convention.
    expect(constraints.get('clients_org_id_organizations_id_fk')).toBe('clients');
  });

  it('reads the app_* functions out of the files RLS_APPLY_ORDER names', () => {
    const functions = declaredFunctions();
    // The delivery portal's read function, and the trigger factory - which live
    // in two different files, so this also proves the manifest is walked.
    expect(functions.has('app_delivery_by_token')).toBe(true);
    expect(functions.get('enforce_immutable_when')).toBe('immutability.sql');
    for (const file of functions.values()) {
      expect(RLS_APPLY_ORDER as readonly string[]).toContain(file);
    }
  });
});

describe('missingColumns', () => {
  it('names a table that is absent entirely', () => {
    const declared = new Map([['boqs', new Set(['id'])]]);
    expect(missingColumns(declared, new Map())).toEqual([
      '  - table boqs is missing entirely',
    ]);
  });

  it('names only the columns that are absent', () => {
    const declared = new Map([['boqs', new Set(['id', 'status', 'issue_date'])]]);
    const applied = new Map([['boqs', new Set(['id', 'status'])]]);
    expect(missingColumns(declared, applied)).toEqual(['  - boqs: issue_date']);
  });

  it('is one-directional: an extra column in the database is not a gap', () => {
    const declared = new Map([['boqs', new Set(['id'])]]);
    const applied = new Map([['boqs', new Set(['id', 'legacy_column'])]]);
    expect(missingColumns(declared, applied)).toEqual([]);
  });
});

describe('missingNames', () => {
  it('says nothing when the exact name is present', () => {
    const declared = new Map([['boqs_client_idx', 'boqs']]);
    expect(missingNames(declared, new Set(['boqs_client_idx']))).toEqual([]);
  });

  it('is one-directional: extra catalogue objects are never reported', () => {
    const declared = new Map([['boqs_client_idx', 'boqs']]);
    const applied = new Set(['boqs_client_idx', 'org_isolation', 'some_other_idx']);
    expect(missingNames(declared, applied)).toEqual([]);
  });

  it('calls a CASE-ONLY difference what it is, and quotes what the database has', () => {
    // The measured shape: 0017 wrote this name unquoted in camelCase, so every
    // database built from these migrations holds the folded form.
    const declared = new Map([['contracts_sourceProposal_idx', 'contracts']]);
    const [line] = missingNames(declared, new Set(['contracts_sourceproposal_idx']));
    expect(line).toContain('CASE-ONLY difference');
    expect(line).toContain('contracts_sourceproposal_idx');
    expect(line).toContain('(on contracts)');
  });

  it('distinguishes "never created" from "folded"', () => {
    const declared = new Map([['boqs_client_idx', 'boqs']]);
    const [line] = missingNames(declared, new Set(['something_else']));
    expect(line).toContain('not in the catalogue under any casing');
    expect(line).not.toContain('CASE-ONLY');
  });
});
