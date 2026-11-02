// A change order as the client home's page holds it. PURE: the page ships its
// figures and how many lines it has, never the lines (they load on a tap) and
// nothing the home does not show (the studio, the contract's number, the link's
// window, how an older decision was recorded).
import type { PublicContractLine } from '@/lib/contracts/public-types';
import { variationCharge } from '@/lib/execution/money/variation-charge';
import type { PublicVariation, PublicVariationLine } from '@/lib/variations/public-types';
import type { HomeChangeOrder } from './types';

export function homeChangeOrderOf(variation: PublicVariation): HomeChangeOrder {
  const { charges, net_delta: netDelta } = variation;
  return {
    id: variation.id,
    number: variation.number,
    title_ar: variation.title_ar,
    title_en: variation.title_en,
    reason_ar: variation.reason_ar,
    reason_en: variation.reason_en,
    net_delta: netDelta,
    charges,
    timeExtensionDays: variation.timeExtensionDays,
    finish: variation.finish,
    total: charges ? variationCharge(netDelta, charges.taxRate, charges.supervisionPct).total : netDelta,
    lineCount: variation.lines.length,
  };
}

/** A change order's line as the shared contract row reads it: it has no item code, and no quantity on it is provisional. */
export function changeOrderLineOf(line: PublicVariationLine): PublicContractLine {
  return { ...line, item_code: null, provisional: false };
}
