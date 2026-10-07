import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A NEW function is executable by PUBLIC (and, on Supabase, by the API roles
// through default privileges) from the moment CREATE FUNCTION commits.
// roles.sql revokes that, but apply-rls runs each manifest file as its own
// transaction and roles.sql comes several files later, so a brand-new token
// function used to be callable with the anon key for the seconds in between.
// CREATE OR REPLACE keeps an existing ACL, so the window only ever exists the
// first time; closing it in the SAME file, right after the CREATE, is what makes
// it zero. This pins that for the Round B token functions (security review S1).
// A future NEW token function belongs in this list too.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/rls

const LOCKED_DOWN_IN_PLACE = [
  {
    file: 'functions/40-delivery-read.sql',
    signature: 'public.app_concept_option_positions(uuid)',
  },
  {
    file: 'functions/50-delivery-write.sql',
    signature:
      'public.app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text)',
  },
  {
    file: 'functions/50-delivery-write.sql',
    signature: 'public.app_delivery_notify_studio_by_token(text, text, jsonb, jsonb)',
  },
  {
    file: 'functions/50-delivery-write.sql',
    signature: 'public.app_delivery_act_notified_by_token(text, text, text)',
  },
] as const;

/** The text from this function's CREATE to the next CREATE (or the end). */
function sectionOf(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function ${name}(`);
  expect(start, `${name} is not created in this file`).toBeGreaterThanOrEqual(0);
  const next = sql.indexOf('create or replace function', start + 1);
  return sql.slice(start, next === -1 ? undefined : next);
}

describe('new token functions are locked down in the transaction that creates them', () => {
  for (const { file, signature } of LOCKED_DOWN_IN_PLACE) {
    const name = signature.slice(0, signature.indexOf('('));
    it(`${name}: revoke from public and the API roles, grant metra_app, right after CREATE`, () => {
      const section = sectionOf(readFileSync(resolve(here, file), 'utf8'), name);
      const afterBody = section.slice(section.indexOf('\n$$;'));
      expect(afterBody).toContain(`revoke all on function ${signature} from public;`);
      expect(afterBody).toContain("array['anon', 'authenticated', 'service_role']");
      expect(afterBody).toContain(`'revoke all on function ${signature} from %I'`);
      expect(afterBody).toContain(`grant execute on function ${signature} to metra_app;`);
    });
  }
});

describe("the notifier's written caller contract matches the R3 repair (B12 S2)", () => {
  it('allows an `already` only when the act was never notified, and names the act on file', () => {
    const sql = readFileSync(resolve(here, 'functions/50-delivery-write.sql'), 'utf8').replace(/\r\n/g, '\n');
    const contract = sql.slice(sql.indexOf('-- THE CALLER CONTRACT (PR-B10).'));
    expect(contract).toContain('app_delivery_act_notified_by_token answered false');
    expect(contract).toContain('the act notified is the\n--     decision actually on file');
    expect(contract).not.toContain('(never on\n--     `already` or a refusal)');
  });
});
