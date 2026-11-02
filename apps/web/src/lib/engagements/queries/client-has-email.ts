// Has the client an address a one-time code could go to: the database's own
// rule (app_client_code_destination: the primary contact's email, else the
// client's own, and it must look like an address). That function is closed to
// the app's role, and only whether an address exists may cross this boundary,
// never the address. So this is a fragment of the caller's statement, costing
// no round trip of its own; engagement-header-client-email.dbtest pins the rule.
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/** The flag for the client `clientId` of `orgId`, as columns or expressions of the caller's statement. */
export function clientHasEmailSql(orgId: SQLWrapper, clientId: SQLWrapper): SQL<boolean> {
  return sql<boolean>`(
    lower(coalesce(
      (select nullif(btrim(cc.email), '') from public.client_contacts cc
        where cc.org_id = ${orgId} and cc.client_id = ${clientId} and cc.is_primary
        limit 1),
      (select nullif(btrim(cl.email), '') from public.clients cl
        where cl.org_id = ${orgId} and cl.id = ${clientId})
    )) ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:].]+$'
  ) is true`;
}
