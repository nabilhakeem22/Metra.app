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
  // Round E (S2): not new, but DROPPED and re-created on every run (a return
  // type change), which resets the ACL exactly as a new function's.
  { file: 'functions/00-org-context.sql', signature: 'public.app_current_user_orgs()', grantsApp: true },
  { file: 'functions/00-org-context.sql', signature: 'public.app_claim_invitation(uuid)', grantsApp: true },
  {
    file: 'functions/40-delivery-read.sql',
    signature: 'public.app_concept_option_positions(uuid)',
    grantsApp: true,
  },
  {
    file: 'functions/50-delivery-write.sql',
    signature:
      'public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)',
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
  {
    file: 'immutability.sql',
    signature: 'public.enforce_client_page_details_writer()',
    grantsApp: true,
  },
  { file: 'rom-issue-trigger.sql', signature: 'public.clear_rom_issue_on_band_change()', grantsApp: true },
  // Stage 2 (0063): the new /c lines reader, and the four /c and /v functions
  // the same file replaces (an existing ACL is kept by CREATE OR REPLACE, so for
  // those the block is convergence; it is pinned so the file stays the place
  // that locks down what it writes).
  {
    file: 'functions/30-contracts-variations.sql',
    signature: 'public.app_contract_section_lines_by_token(text, uuid, integer)',
    grantsApp: true,
  },
  // A2 fix round (R2): the payment-fits guard, an invoker trigger function (S5).
  { file: 'functions/35-execution.sql', signature: 'public.enforce_contract_payment_fits()', grantsApp: true },
  // DB step B: the /c sections page; the /d execution card, the client's
  // "I paid" and their two INTERNAL helpers (no grant, metra_app included);
  // the cost entry's guard and the actor check (trigger functions).
  { file: 'functions/30-contracts-variations.sql', signature: 'public.app_contract_sections_by_token(text, integer)', grantsApp: true },
  { file: 'functions/70-execution-portal.sql', signature: 'public.app_delivery_execution_by_token(text)', grantsApp: true },
  {
    file: 'functions/70-execution-portal.sql',
    signature: 'public.app_delivery_claim_request_by_token(text, uuid, text, text, text, text)',
    grantsApp: true,
  },
  { file: 'functions/70-execution-portal.sql', signature: 'public.app_delivery_execution_contract(uuid, uuid)', grantsApp: false },
  { file: 'functions/70-execution-portal.sql', signature: 'public.app_studio_payment_details(uuid)', grantsApp: false },
  { file: 'functions/35-execution.sql', signature: 'public.enforce_cost_entry_guarded()', grantsApp: true },
  { file: 'functions/35-execution.sql', signature: 'public.enforce_actor_is_session_user()', grantsApp: true },
  { file: 'functions/30-contracts-variations.sql', signature: 'public.app_contract_by_token(text)', grantsApp: true },
  {
    file: 'functions/30-contracts-variations.sql',
    signature: 'public.app_contract_ack_by_token(text, text, text, text, text)',
    grantsApp: true,
  },
  { file: 'functions/30-contracts-variations.sql', signature: 'public.app_variation_by_token(text)', grantsApp: true },
  {
    file: 'functions/30-contracts-variations.sql',
    signature: 'public.app_variation_respond_by_token(text, text, text, text, text)',
    grantsApp: true,
  },
  // Stage 3 (0064): the session-scoped org list, the assignment write gate the
  // restrictive insert policy calls, and the client's published site updates.
  {
    file: 'functions/00-org-context.sql',
    signature: 'public.app_current_user_orgs_for_session(uuid)',
    grantsApp: true,
  },
  { file: 'functions/80-site.sql', signature: 'public.app_may_write_site_project(uuid)', grantsApp: true },
  // ...and, from the S2 fix round, the manager gate and the photo object key.
  { file: 'functions/80-site.sql', signature: 'public.app_may_manage_site_project()', grantsApp: true },
  // ...and, from the S2 re-check, the own-row rule.
  { file: 'functions/80-site.sql', signature: 'public.app_is_self_or_site_manager(uuid)', grantsApp: true },
  {
    file: 'functions/80-site.sql',
    signature: 'public.site_photo_object_key(uuid, uuid, uuid, text)',
    grantsApp: true,
  },
  {
    file: 'functions/85-site-portal.sql',
    signature: 'public.app_delivery_site_updates_by_token(text, date, integer)',
    grantsApp: true,
  },  // Client home DB step C: the execution fact source the studio reads as
  // metra_app under RLS (invokers, granted); the shared helpers that take bare
  // ids for the definer callers (INTERNAL, no grant); the change order's
  // frozen guard; and the client home's token functions, internal helpers
  // and the code's guard.
  { file: 'functions/65-execution-facts.sql', signature: 'public.app_delivery_boqs(uuid, uuid)', grantsApp: true },
  { file: 'functions/65-execution-facts.sql', signature: 'public.app_delivery_current_contract(uuid, uuid)', grantsApp: true },
  { file: 'functions/65-execution-facts.sql', signature: 'public.app_contract_measured_lines(uuid)', grantsApp: true },
  { file: 'functions/65-execution-facts.sql', signature: 'public.app_contract_measured_works(uuid)', grantsApp: true },
  { file: 'functions/65-execution-facts.sql', signature: 'public.app_contract_money_facts(uuid)', grantsApp: true },
  { file: 'functions/65-execution-facts.sql', signature: 'public.app_execution_flow_source(uuid)', grantsApp: true },
  { file: 'functions/70-execution-portal.sql', signature: 'public.app_payment_request_due(uuid, uuid)', grantsApp: false },
  { file: 'functions/50-delivery-write.sql', signature: 'public.app_engagement_milestone_due(uuid, text)', grantsApp: false },
  { file: 'functions/30-contracts-variations.sql', signature: 'public.app_contract_signed(uuid, uuid)', grantsApp: false },
  { file: 'functions/30-contracts-variations.sql', signature: 'public.app_contract_time_extension_days(uuid, uuid)', grantsApp: false },
  { file: 'functions/30-contracts-variations.sql', signature: 'public.enforce_variation_order_frozen()', grantsApp: true },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_delivery(text)', grantsApp: false },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_contract(text)', grantsApp: false },
  { file: 'functions/75-client-home.sql', signature: 'public.app_client_code_destination(uuid, uuid)', grantsApp: false },
  { file: 'functions/75-client-home.sql', signature: 'public.app_email_hint(text)', grantsApp: false },
  { file: 'functions/75-client-home.sql', signature: 'public.app_client_code_check(uuid, uuid, uuid, text, text, text)', grantsApp: false },
  { file: 'functions/75-client-home.sql', signature: 'public.app_client_code_refusal(text)', grantsApp: false },
  { file: 'functions/75-client-home.sql', signature: 'public.app_client_code_consume(uuid, uuid)', grantsApp: false },
  { file: 'functions/75-client-home.sql', signature: 'public.enforce_client_code_guarded()', grantsApp: true },
  { file: 'functions/75-client-home.sql', signature: 'public.app_contract_terminated_at(uuid, uuid)', grantsApp: false },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_flow_source(uuid)', grantsApp: false },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_by_token(text)', grantsApp: true },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_contract_by_token(text)', grantsApp: true },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_contract_sections_by_token(text, uuid, integer)', grantsApp: true },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_contract_section_lines_by_token(text, uuid, uuid, integer)', grantsApp: true },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_variations_by_token(text)', grantsApp: true },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_code_issue_by_token(text, uuid, text, text, text, text, text)', grantsApp: true },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_contract_ack_by_token(text, uuid, uuid, text, text, text, text, text)', grantsApp: true },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_variation_respond_by_token(text, uuid, text, uuid, text, text, text, text)', grantsApp: true },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_claim_request_by_token(text, uuid, uuid, text, text, text, text, text)', grantsApp: true },
  { file: 'functions/75-client-home.sql', signature: 'public.app_home_claim_design_payment_by_token(text, text, uuid, text, text, text, text, text)', grantsApp: true },
  { file: 'functions/75-client-home.sql', signature: 'public.app_client_home_target_by_token(text, text)', grantsApp: true },
];

/** The argument types a CREATE declares, as `pg_proc` would list them: `text, uuid`. */
function argumentTypesOf(create: string): string {
  const list = create.slice(create.indexOf('(') + 1, create.indexOf(')'));
  return list.split(',').map((parameter) => parameter.trim().split(/\s+/).pop()).filter(Boolean).join(', ');
}

/**
 * The text from the CREATE of exactly this signature to the next CREATE (or
 * the end). An overload shares its name, so the argument types pick the CREATE.
 */
function sectionOf(sql: string, signature: string): string {
  const name = signature.slice(0, signature.indexOf('('));
  const argumentTypes = signature.slice(signature.indexOf('(') + 1, -1);
  const creates = sql.split('create or replace function ').slice(1);
  const section = creates.find(
    (create) => create.startsWith(`${name}(`) && argumentTypesOf(create) === argumentTypes,
  );
  expect(section, `${signature} is not created in this file`).toBeDefined();
  return `create or replace function ${section}`;
}

describe('new token functions are locked down in the transaction that creates them', () => {
  for (const { file, signature, grantsApp } of LOCKED_DOWN_IN_PLACE) {
    const name = signature.slice(0, signature.indexOf('('));
    const grant = grantsApp ? 'grant metra_app' : 'revoke metra_app too and grant nobody';
    it(`${name}: revoke from public and the API roles, ${grant}, right after CREATE`, () => {
      const section = sectionOf(readFileSync(resolve(here, file), 'utf8'), signature);
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
