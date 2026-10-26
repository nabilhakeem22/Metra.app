// The client home (/d) as the browser receives it. PURE TYPES and CLIENT-SAFE:
// the server reader (./read.ts) builds them, the page renders them. The home's
// token function also answers the studio's own execution fact source; the
// reader turns it into WHERE the client stands (`location`) and drops it, so no
// fact of the studio's (a balance, a rate, an internal change order) is ever
// part of this shape (H3 ruling D2).
import type { PortalExecution, PortalContractStatus } from '@/lib/engagements/public/execution-types';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import type { ClientExecutionLocation } from '@/lib/flow/locate/execution-client';
import type { EntryPhase, PhaseKey } from '@/lib/flow/types';

/** The studio, as every client page shows it (lib/engagements/public/studio-rows.ts). */
type PortalFirm = PublicDelivery['firm'];

/** The home's execution contract, as the client may see it. */
export interface HomeContract {
  id: string;
  /** C-YYYY-NNNN. */
  documentNumber: string;
  status: PortalContractStatus;
  /** Issued, and its 30-day online signing window still open (OD7). */
  signingOpen: boolean;
  /** The signing day (`YYYY-MM-DD`, Cairo) and how: online, or on paper with the studio. */
  signed: { on: string; via: 'online' | 'paper' } | null;
  /** The end date plus the days approved change orders added (`YYYY-MM-DD`); null without an end date. */
  revisedFinish: string | null;
  /** When it was terminated (an ISO instant); null unless it was. */
  terminatedAt: string | null;
}

/** What the home says about the delivery's execution, beyond the money card. */
interface HomeExecutionFacts {
  contract: HomeContract | null;
  /** An older contract of the delivery that was terminated (an ISO instant), or null. */
  previousContractTerminatedAt: string | null;
  /** Change orders issued to the client that they can still answer online. */
  openVariationCount: number;
  /** Change orders issued to the client whose link has lapsed: the studio will follow them up. */
  lapsedVariationCount: number;
}

export interface HomeExecution extends HomeExecutionFacts {
  /** Where the client stands: the reason, the step and whose move it is (lib/flow/locate/execution-client.ts). */
  location: ClientExecutionLocation;
  /** The payment requests, how to pay and the receipts (B4); null with no contract the client can see. */
  money: PortalExecution | null;
}

export interface PortalHome {
  delivery: {
    /** DE-YYYY-NNNN. */
    documentNumber: string;
    titleAr: string | null;
    titleEn: string | null;
    entryPhase: EntryPhase;
    phase: PhaseKey | 'closed';
  };
  firm: PortalFirm;
  client: { nameAr: string | null; nameEn: string | null };
  /** Where a one-time code would go (`n•••@g•••.com`), or null when the client has no address on file. */
  codeChannel: { hint: string } | null;
  /** Null unless the delivery is at `execution`. */
  execution: HomeExecution | null;
}

/**
 * Why the studio is not handed the home's link (lib/client-home/ensure.ts): the
 * link cannot be shown (no secret to re-derive it with, or a live link that
 * cannot be re-derived).
 */
export type ClientHomeLinkReason = 'delivery_links_not_configured' | 'delivery_link_unrecoverable';

/** The home's link as the studio is handed it, or why there is none. */
export type ClientHomeLink = { link: string; linkReason?: never } | { link: null; linkReason: ClientHomeLinkReason };

/** A home whose Execution tab can be shown: the delivery is at `execution`. */
export type HomeAtExecution = PortalHome & { execution: HomeExecution };

/**
 * `not_found` is PERMANENT (an unknown, revoked or expired link, or a payload
 * this build cannot shape); `read_failed` is TRANSIENT (the database or the
 * shaping threw), exactly as the delivery reader tells them apart.
 */
export type HomeReadResult = { status: 'ok'; home: PortalHome } | { status: 'not_found' } | { status: 'read_failed' };
