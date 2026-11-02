import 'server-only';
// Where an old /v link lands (H7.2): a BOQ contract's change order is decided in
// the client home, so while one awaits that decision its link opens the home on
// it. An order whose contract is still unsigned has nowhere to be decided yet, so
// its link stays and says the signature comes first; the home is the only reader
// that can tell (the order's document does not say, and this asks no new read).
import type { Locale } from '@/i18n/routing';
import { isUuid } from '@/lib/uuid';
import { decidesInClientHome, isOpenForDecision } from '@/lib/variations/home-deciding';
import type { PublicVariation } from '@/lib/variations/public-types';
import { documentHomeRedirect } from './redirect';
import { orderStandingInHome } from './variations';

/** Where an old /v link lands: the home path, or its own page, which says when the order waits for the contract's signature. */
export interface VariationLinkLanding {
  homePath: string | null;
  waitsForSignature: boolean;
}

/**
 * Where an old /v link leads. Only a BOQ contract's change order still awaiting
 * the client's decision, in its window, asks at all (as for /c, security S1), so
 * every other link reads nothing more than on main. The home lists the newest 10
 * orders of its current contract, so an order it does not list stays on /v. Only
 * the home knows its contract is unsigned (the order's document does not say), so
 * a link with no home this server can read answers false.
 */
export async function variationLinkLanding(rawToken: string, variation: PublicVariation | null, locale: Locale): Promise<VariationLinkLanding> {
  const asks = variation !== null && decidesInClientHome(variation) && isOpenForDecision(variation, Date.now());
  const heard = { waitsForSignature: false };
  const homePath = await documentHomeRedirect(
    rawToken,
    asks
      ? {
          kind: 'variation',
          focusOf: ({ focus_id: id }) => (isUuid(id) ? `variation:${id.toLowerCase()}` : null),
          shownBy: async (homeRaw) => {
            const standing = await orderStandingInHome(homeRaw, variation);
            heard.waitsForSignature = standing === 'waits_for_signature';
            return standing === 'shown';
          },
        }
      : null,
    locale,
  );
  return { homePath, waitsForSignature: heard.waitsForSignature };
}
