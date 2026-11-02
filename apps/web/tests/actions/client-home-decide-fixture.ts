// H7.1 DB-test fixture: a home with an issued change order, its code as the client
// reads it from the (fake) email, and the decision through the real actions. Not a
// test file: each test file mocks the sender, the headers and sdf-call itself.
import { requestClientCode } from '@/app/[locale]/d/[token]/code-actions';
import { decideVariationInHome } from '@/app/[locale]/d/[token]/variation-actions';
import { mintShareToken } from '@/lib/share/token';
import { seedHome, type Home } from './client-home-fixture';
import { ownerQuery, seedVariation, tamper } from './execution-fixture';

export const NAME = ' \u202eهشام   عادل\u0000 ';
export const DECIDED_AS = 'هشام عادل';

/** A home (a fresh one by default) with one issued order of three lines; the raw links are added to `raws`. */
export async function homeWithOrder(orgId: string, raws: string[], home?: Home) {
  const seeded = home ?? (await seedHome(orgId, 'signed'));
  raws.push(seeded.delivery.rawToken);
  const link = mintShareToken();
  raws.push(link.raw);
  const order = await seedVariation(orgId, seeded.contract, 'issued', { tokenHash: link.hash, timeExtensionDays: 7 });
  await tamper(
    `insert into public.variation_order_lines (org_id, variation_order_id, description_en, qty, unit, unit_price, line_total, sort_order)
     select $1, $2, 'SEEDED LINE ' || n, 1, 'sqm', 10, 10, 4 - n from generate_series(1, 3) n`,
    [orgId, order.id],
  );
  return { home: seeded, order, link };
}

/** Ask for a decision code; the code the client would read in the email (the newest in `sent`). */
export async function askForCode(sent: Array<{ code: string }>, home: Home, orderId: string) {
  const answer = await requestClientCode(home.delivery.rawToken, { purpose: 'decide_variation', target: orderId });
  if (!answer.ok) throw new Error(`no code: ${answer.error}`);
  return { code: sent[sent.length - 1].code, answer };
}

export const decide = (home: Home, variationId: string, code: string, decision: 'approve' | 'reject' = 'approve', name: unknown = NAME) =>
  decideVariationInHome(home.delivery.rawToken, { variationId, decision, name: name as string, code });

/** The order's status and its decision events. */
export async function orderState(orderId: string) {
  const [row] = await ownerQuery<{ status: string; events: Array<{ id: string; kind: string; actor_channel: string; actor_name: string; ip: string; user_agent: string }> | null }>(
    `select v.status::text,
            (select json_agg(json_build_object('id', e.id, 'kind', e.kind, 'actor_channel', e.actor_channel, 'actor_name', e.actor_name, 'ip', e.ip, 'user_agent', e.user_agent))
               from public.variation_order_events e where e.variation_order_id = v.id and e.kind in ('approved', 'rejected')) as events
       from public.variation_orders v where v.id = $1`,
    [orderId],
  );
  return { status: row.status, events: row.events ?? [] };
}
