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
//
// `grantsApp: false` marks an INTERNAL helper (Round C's anchor rule): revoked
// from every caller role, metra_app included, and granted to nobody; only the
// definer functions beside it call it, as their owner.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/rls

interface LockedDown {
  file: string;
  signature: string;
  grantsApp: boolean;
}

const LOCKED_DOWN_IN_PLACE: readonly LockedDown[] = [
  {
    file: 'functions/40-delivery-read.sql',
    signature: 'public.app_concept_option_positions(uuid)',
    grantsApp: true,
  },
  {
    file: 'functions/50-delivery-write.sql',
    signature:
      'public.app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text)',
    grantsApp: true,
  },
  {
    file: 'functions/50-delivery-write.sql',
    signature: 'public.app_delivery_notify_studio_by_token(text, text, jsonb, jsonb)',
    grantsApp: true,
  },
  {
    file: 'functions/50-delivery-write.sql',
    signature: 'public.app_delivery_act_notified_by_token(text, text, text)',
    grantsApp: true,
  },
  {
    file: 'functions/40-delivery-read.sql',
    signature: 'public.app_document_media(text)',
    grantsApp: true,
  },
  {
    file: 'functions/60-delivery-documents.sql',
    signature: 'public.app_delivery_logo_by_token(text)',
    grantsApp: true,
  },
  {
    file: 'functions/50-delivery-write.sql',
    signature: 'public.app_delivery_close_target_by_token(text)',
    grantsApp: true,
  },
  {
    file: 'functions/50-delivery-write.sql',
    signature: 'public.app_notify_lost_client_acts(timestamptz, timestamptz, jsonb)',
    grantsApp: true,
  },
  {
    file: 'functions/50-delivery-write.sql',
    signature: 'public.app_client_act_anchor(uuid, uuid, text, text)',
    grantsApp: false,
  },
];

/** The text from this function's CREATE to the next CREATE (or the end). */
function sectionOf(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function ${name}(`);
  expect(start, `${name} is not created in this file`).toBeGreaterThanOrEqual(0);
  const next = sql.indexOf('create or replace function', start + 1);
  return sql.slice(start, next === -1 ? undefined : next);
}

describe('new token functions are locked down in the transaction that creates them', () => {
  for (const { file, signature, grantsApp } of LOCKED_DOWN_IN_PLACE) {
    const name = signature.slice(0, signature.indexOf('('));
    const grant = grantsApp ? 'grant metra_app' : 'revoke metra_app too and grant nobody';
    it(`${name}: revoke from public and the API roles, ${grant}, right after CREATE`, () => {
      const section = sectionOf(readFileSync(resolve(here, file), 'utf8'), name);
      const afterBody = section.slice(section.indexOf('\n$$;'));
      expect(afterBody).toContain(`revoke all on function ${signature} from public;`);
      expect(afterBody).toContain(`'revoke all on function ${signature} from %I'`);
      if (grantsApp) {
        expect(afterBody).toContain("array['anon', 'authenticated', 'service_role']");
        expect(afterBody).toContain(`grant execute on function ${signature} to metra_app;`);
      } else {
        expect(afterBody).toContain("array['anon', 'authenticated', 'service_role', 'metra_app']");
        expect(afterBody).not.toContain('grant execute');
      }
    });
  }
});

describe('roles.sql never grants the internal anchor rule', () => {
  it('revokes app_client_act_anchor from public and metra_app and grants it to no one', () => {
    const roles = readFileSync(resolve(here, 'roles.sql'), 'utf8');
    const signature = 'public.app_client_act_anchor(uuid, uuid, text, text)';
    expect(roles).toContain(`revoke execute on function ${signature} from public;`);
    expect(roles).toContain(`revoke execute on function ${signature} from metra_app;`);
    expect(roles).toContain(`'revoke execute on function ${signature} from %I'`);
    expect(roles).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.app_client_act_anchor/i);
  });
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
