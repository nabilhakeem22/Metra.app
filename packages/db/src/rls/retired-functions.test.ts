import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RLS_APPLY_ORDER } from './manifest';

// Round E (0060) DROPS the six-argument app_delivery_respond_by_token, the
// respond write without the issuance the client saw. apply-rls never drops a
// function on its own, so the only thing that keeps it gone is the explicit
// DROP in 50-delivery-write.sql, and the only thing that would bring it back is
// a CREATE or a grant naming its argument list. This pins both, over every file
// apply-rls runs: the six-argument list appears exactly once, in that DROP,
// which runs before the seven-argument CREATE.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/rls

const RETIRED_DROP =
  'drop function if exists public.app_delivery_respond_by_token(text, text, text, text, text, text);';
const SEVEN_ARGUMENT_CREATE =
  'create or replace function public.app_delivery_respond_by_token(\n  p_hash text,\n  p_action text,\n  p_expected_issue_at timestamptz,';

/** The six-argument respond signature in any spelling: case, quotes, spaces and line breaks. */
const SIX_ARGUMENT_SIGNATURE =
  /"?app_delivery_respond_by_token"?\s*\(\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*\)/gi;

/** A CREATE of the respond function and its parameter list, up to the closing parenthesis. */
const RESPOND_CREATE = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?app_delivery_respond_by_token"?\s*\(([^)]*)\)/gi;

function rlsFile(file: string): string {
  return readFileSync(resolve(here, file), 'utf8').replace(/\r\n/g, '\n');
}

/** The argument types a parameter list declares, as pg_proc lists them: `text, timestamptz`. */
function argumentTypesOf(parameters: string): string {
  return parameters
    .split(',')
    .map((parameter) => parameter.trim().split(/\s+/).pop())
    .filter(Boolean)
    .join(', ');
}

describe('the retired six-argument respond write stays dropped (0060)', () => {
  it('no file apply-rls runs creates the respond write with six text arguments', () => {
    const creates = RLS_APPLY_ORDER.flatMap((file) =>
      [...rlsFile(file).matchAll(RESPOND_CREATE)].map((match) => `${file}: ${argumentTypesOf(match[1])}`),
    );
    expect(creates).toEqual(['functions/50-delivery-write.sql: text, text, timestamptz, text, text, text, text']);
  });

  it('50-delivery-write.sql drops it right before the seven-argument CREATE', () => {
    const sql = rlsFile('functions/50-delivery-write.sql');
    const drop = sql.indexOf(RETIRED_DROP);
    expect(drop, 'the exact drop statement').toBeGreaterThan(-1);
    expect(sql.indexOf(`${RETIRED_DROP}\n${SEVEN_ARGUMENT_CREATE}`)).toBe(drop);
  });

  it('the six-argument signature appears in no other statement, roles.sql included', () => {
    const mentions = RLS_APPLY_ORDER.flatMap((file) =>
      [...rlsFile(file).matchAll(SIX_ARGUMENT_SIGNATURE)].map((match) => `${file}: ${match[0]}`),
    );
    expect(mentions).toEqual(['functions/50-delivery-write.sql: app_delivery_respond_by_token(text, text, text, text, text, text)']);
    expect(rlsFile('roles.sql')).not.toMatch(SIX_ARGUMENT_SIGNATURE);
  });

  it('the matcher reads every spelling of the signature', () => {
    for (const spelling of [
      'grant execute on function public.APP_DELIVERY_RESPOND_BY_TOKEN(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) to metra_app',
      'revoke all on function public."app_delivery_respond_by_token" (text,text,text,text,text,text) from public',
      'execute format(\'revoke execute on function public.app_delivery_respond_by_token(\n  text, text, text, text, text, text) from %I\', r)',
    ]) {
      expect(spelling.match(SIX_ARGUMENT_SIGNATURE), spelling).toHaveLength(1);
    }
    expect('app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)'.match(SIX_ARGUMENT_SIGNATURE)).toBeNull();
  });
});

// Client codes DB step D (H6-read security S1) DROPS the unbound forms of the
// home contract's two page reads; their replacements take the contract the
// client opened. Each old argument list appears exactly once, in its DROP,
// right before the CREATE of the bound form, and nowhere else (roles.sql too).
describe('the unbound home contract page reads stay dropped (step D)', () => {
  const RETIRED = [
    {
      drop: 'drop function if exists public.app_home_contract_sections_by_token(text, integer);',
      create: 'create or replace function public.app_home_contract_sections_by_token(\n  p_hash text,\n  p_contract_id uuid,',
      signature: /"?app_home_contract_sections_by_token"?\s*\(\s*text\s*,\s*integer\s*\)/gi,
    },
    {
      drop: 'drop function if exists public.app_home_contract_section_lines_by_token(text, uuid, integer);',
      create: 'create or replace function public.app_home_contract_section_lines_by_token(\n  p_hash text,\n  p_contract_id uuid,',
      signature: /"?app_home_contract_section_lines_by_token"?\s*\(\s*text\s*,\s*uuid\s*,\s*integer\s*\)/gi,
    },
  ];

  it.each(RETIRED)('$drop: once, right before the bound CREATE, and in no other statement', ({ drop, create, signature }) => {
    const sql = rlsFile('functions/75-client-home.sql');
    expect(sql.indexOf(`${drop}\n${create}`), 'the drop right before the bound create').toBeGreaterThan(-1);
    const mentions = RLS_APPLY_ORDER.flatMap((file) => [...rlsFile(file).matchAll(signature)].map(() => file));
    expect(mentions).toEqual(['functions/75-client-home.sql']);
    expect(rlsFile('roles.sql')).not.toMatch(signature);
  });
});

// Client codes DB step D (H5 functional F1) DROPS the forms of the code
// request, the code check and the four code-checked acts that took a code id
// from the browser: the new forms check a code by its act's target. Each old
// argument list appears exactly once, in its DROP, right before the CREATE of
// the new form, and nowhere else (roles.sql too), so no re-run of apply-rls
// can bring one back.
describe('the code functions that took a code id stay dropped (step D)', () => {
  const RETIRED = [
    {
      name: 'app_home_code_issue_by_token',
      oldArguments: 'text, uuid, text, text, text, text, text',
      createOpening: 'create or replace function public.app_home_code_issue_by_token(\n  p_hash text,\n  p_purpose text,',
    },
    {
      name: 'app_client_code_check',
      oldArguments: 'uuid, uuid, uuid, text, text, text',
      createOpening: 'create or replace function public.app_client_code_check(\n  p_engagement_id uuid,\n  p_org_id uuid,\n  p_purpose text,',
    },
    {
      name: 'app_home_contract_ack_by_token',
      oldArguments: 'text, uuid, uuid, text, text, text, text, text',
      createOpening: 'create or replace function public.app_home_contract_ack_by_token(\n  p_hash text,\n  p_contract_id uuid,\n  p_code_hash text,',
    },
    {
      name: 'app_home_variation_respond_by_token',
      oldArguments: 'text, uuid, text, uuid, text, text, text, text',
      createOpening:
        'create or replace function public.app_home_variation_respond_by_token(\n  p_hash text,\n  p_variation_id uuid,\n  p_decision text,\n  p_code_hash text,',
    },
    {
      name: 'app_home_claim_request_by_token',
      oldArguments: 'text, uuid, uuid, text, text, text, text, text',
      createOpening: 'create or replace function public.app_home_claim_request_by_token(\n  p_hash text,\n  p_request_id uuid,\n  p_code_hash text,',
    },
    {
      name: 'app_home_claim_design_payment_by_token',
      oldArguments: 'text, text, uuid, text, text, text, text, text',
      createOpening:
        'create or replace function public.app_home_claim_design_payment_by_token(\n  p_hash text,\n  p_milestone_kind text,\n  p_code_hash text,',
    },
  ];

  /** The old signature in any spelling: case, quotes, spaces and line breaks. */
  const signatureOf = (name: string, oldArguments: string) =>
    new RegExp(`"?${name}"?\\s*\\(\\s*${oldArguments.split(', ').join('\\s*,\\s*')}\\s*\\)`, 'gi');

  it.each(RETIRED)('$name($oldArguments): once, in its DROP right before the new CREATE, and in no other statement', ({ name, oldArguments, createOpening }) => {
    const sql = rlsFile('functions/75-client-home.sql');
    const drop = `drop function if exists public.${name}(${oldArguments});`;
    expect(sql.indexOf(`${drop}\n${createOpening}`), 'the drop right before the new create').toBeGreaterThan(-1);
    const mentions = RLS_APPLY_ORDER.flatMap((file) => [...rlsFile(file).matchAll(signatureOf(name, oldArguments))].map(() => file));
    expect(mentions).toEqual(['functions/75-client-home.sql']);
    expect(rlsFile('roles.sql')).not.toMatch(signatureOf(name, oldArguments));
  });
});
