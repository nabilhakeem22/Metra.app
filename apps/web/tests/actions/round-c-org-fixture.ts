// The studio's client-page columns (0058) as the suites write them. Not a test
// file. Since trg_organizations_client_page_writer, a change to any of the
// seven columns needs the app's GUCs naming an owner or admin of that org, so
// these helpers write the way the app does: inside ONE transaction that first
// sets app.current_org_id / app.current_user_id (a multi-statement simple
// query is one implicit transaction, so the transaction-local GUCs cover it).
import { sqlstateOf } from '@metra/db/sqlstate';
import { raw } from './fixture';

/** A SQL literal for a nullable string. */
function literal(value: string | null): string {
  return value === null ? 'null' : `'${value.replace(/'/g, "''")}'`;
}

export interface Actor {
  userId: string;
  /** The org the GUCs name; defaults to the org being updated. */
  orgId?: string;
}

/**
 * Run `update organizations set <assignment>` on one org, as `actor` (the
 * app's GUCs) or with no GUCs at all (null). Answers 'ok' or the SQLSTATE.
 */
export async function updateOrganization(
  orgId: string,
  assignment: string,
  actor: Actor | null,
): Promise<string> {
  const gucs = actor
    ? `select set_config('app.current_org_id', '${actor.orgId ?? orgId}', true),
              set_config('app.current_user_id', '${actor.userId}', true);`
    : '';
  return raw
    .query(`${gucs} update public.organizations set ${assignment} where id = '${orgId}'`)
    .then(() => 'ok', (error: unknown) => sqlstateOf(error) ?? 'unknown');
}

/** The org's first owner, the actor the suites write the studio's details as. */
export async function ownerOf(orgId: string): Promise<string> {
  const [row] = await raw.query<{ user_id: string }>(
    `select user_id from public.memberships where org_id = '${orgId}' and role = 'owner'
      order by user_id limit 1`,
  );
  return row.user_id;
}

/** Set the studio's client-page columns as the org's owner; throws on a refusal. */
export async function setStudioDetails(
  orgId: string,
  details: Record<string, string | null>,
): Promise<void> {
  const assignment = Object.entries(details)
    .map(([column, value]) => `${column} = ${literal(value)}`)
    .join(', ');
  const outcome = await updateOrganization(orgId, assignment, { userId: await ownerOf(orgId) });
  if (outcome !== 'ok') throw new Error(`setStudioDetails refused: ${outcome}`);
}

/** A studio with every client-page detail set, all of them valid. */
export const STUDIO_DETAILS = {
  studio_phone: '+201012345678',
  studio_whatsapp: '01012345678',
  instapay_address: 'studio@instapay',
  bank_name: 'CIB',
  bank_account_holder: 'Studio LLC',
  bank_account_number: '100023456789',
  bank_iban: 'EG380019000500000000263180002',
};

/** What app_delivery_by_token returns as `payment_details` for STUDIO_DETAILS. */
export const STUDIO_PAYMENT_DETAILS = {
  instapay: 'studio@instapay',
  bank_name: 'CIB',
  bank_account_holder: 'Studio LLC',
  bank_account_number: '100023456789',
  bank_iban: 'EG380019000500000000263180002',
};
