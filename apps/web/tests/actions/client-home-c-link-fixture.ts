// H6.3 DB-test fixture: a home's client link as the studio first shares it,
// re-derivable (SHARE_LINK_SECRET set by the test), in place of the random,
// non-derivable link the home fixtures seed. Not a test file.
import type { Locale } from '@/i18n/routing';
import { contractHomeRedirect } from '@/lib/client-home/redirect';
import { getContractByToken } from '@/lib/contracts/public';
import type { OrgContext } from '@/lib/db/context';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import type { Home } from './client-home-fixture';
import { ownerQuery } from './execution-fixture';

/** The home's freshly minted raw link (mintDeliveryLinkCore), the seeded one cleared first. */
export async function mintHomeLink(owner: OrgContext, home: Home): Promise<string> {
  await ownerQuery(`update public.design_engagements set token_hash = null, token_nonce = null where id = $1`, [home.delivery.id]);
  const res = await mintDeliveryLinkCore(owner, home.delivery.id);
  if (!res.ok || !res.data) throw new Error(`mintDeliveryLinkCore: ${String(res.error)}`);
  return res.data;
}

/** The /c page's gate, as it reads: the link's contract, then where it leads. */
export async function redirectOf(cRaw: string, locale: Locale): Promise<string | null> {
  return contractHomeRedirect(cRaw, await getContractByToken(cRaw), locale);
}

/** Where an old /c link of the home's contract sends its holder. */
export const homePathOf = (locale: string, homeRaw: string) => `/${locale}/d/${homeRaw}?tab=execution&focus=contract`;
