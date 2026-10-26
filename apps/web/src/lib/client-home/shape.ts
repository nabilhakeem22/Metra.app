// The home's payload (app_home_by_token) mapped onto what the browser receives
// (./types.ts). UNTRUSTED like every token payload: a malformed delivery, firm
// or contract answers null (the page's not-found), and no key is copied
// through by spreading, so a key the SQL adds later never reaches the browser
// unless it is named here.
//
// THE FACT SOURCE STOPS HERE (H3 ruling D2). `execution.flow_source` is the
// studio's own fact source as the client may hold it; it is derived through
// the SAME code the cockpit runs (lib/execution/flow-facts.ts, the parity
// ruling) into where the client stands, and is then dropped. Facts no query
// can produce throw there (H1 ruling F8): the reader answers read_failed.
import { executionCardFactsOf } from '@/lib/execution/flow-facts';
import { executionFlowSourceOf } from '@/lib/execution/flow-source';
import { revisedFinishDate } from '@/lib/execution/finish-date';
import { shapeExecution } from '@/lib/engagements/public/execution-shape';
import type { PortalContractStatus } from '@/lib/engagements/public/execution-types';
import { boundedText, calendarDay, isoInstant } from '@/lib/engagements/public/snapshot-values';
import { parseFirm, type FirmRow } from '@/lib/engagements/public/studio-rows';
import { locateExecutionForClient } from '@/lib/flow/locate/execution-client';
import type { EntryPhase, PhaseKey } from '@/lib/flow/types';
import { formatDocNumber } from '@/lib/format/doc-number';
import { isUuid } from '@/lib/uuid';
import type { HomeContract, HomeExecution, PortalHome } from './types';

type Row = Record<string, unknown>;

/** A title the studio typed; the SQL holds it to its column's cap. */
const TITLE_MAX = 300;

/** The longest hint app_email_hint writes. */
const HINT_MAX = 80;

const ENTRY_PHASES: ReadonlySet<string> = new Set<EntryPhase>(['design', 'execution']);
const PHASES: ReadonlySet<string> = new Set<PhaseKey | 'closed'>(['design', 'execution', 'closed']);
const CONTRACT_STATUSES: ReadonlySet<string> = new Set<PortalContractStatus>(['issued', 'signed', 'terminated']);

const asRow = (raw: unknown): Row | null => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Row) : null);

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const wholeNumber = (value: unknown, min: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min ? value : null;

/** PREFIX-YYYY-NNNN from a number and a year, or null when either is not one. */
function documentNumber(prefix: 'C' | 'DE', number: unknown, year: unknown): string | null {
  const seq = wholeNumber(number, 1);
  const at = wholeNumber(year, 1);
  return seq && at ? formatDocNumber(prefix, seq, at) : null;
}

function signedOf(raw: unknown): HomeContract['signed'] {
  const row = asRow(raw);
  const on = calendarDay(row?.on);
  if (!row || !on || (row.via !== 'online' && row.via !== 'paper')) return null;
  return { on, via: row.via };
}

/** The contract, or null when there is none; `undefined` when it is malformed. */
function contractOf(raw: unknown): HomeContract | null | undefined {
  if (raw === null || raw === undefined) return null;
  const row = asRow(raw);
  if (!row || typeof row.id !== 'string' || !isUuid(row.id)) return undefined;
  const number = documentNumber('C', row.number, row.year);
  const extensionDays = wholeNumber(row.time_extension_days_total, 0);
  if (!number || typeof row.status !== 'string' || !CONTRACT_STATUSES.has(row.status) || extensionDays === null) return undefined;
  return {
    id: row.id,
    documentNumber: number,
    status: row.status as PortalContractStatus,
    signingOpen: row.signing_open === true,
    signed: signedOf(row.signed),
    revisedFinish: revisedFinishDate(calendarDay(row.end_date), extensionDays),
    terminatedAt: isoInstant(row.terminated_at),
  };
}

/** The execution block, or `undefined` when its contract is malformed. */
function executionOf(raw: Row): HomeExecution | undefined {
  const contract = contractOf(raw.contract);
  if (contract === undefined) return undefined;
  const { flow } = executionCardFactsOf(executionFlowSourceOf(raw.flow_source));
  return {
    contract,
    previousContractTerminatedAt: isoInstant(asRow(raw.previous_contract)?.terminated_at),
    openVariationCount: flow.issuedChangeOrderCount,
    lapsedVariationCount: flow.expiredChangeOrderCount,
    location: locateExecutionForClient(flow),
    money: shapeExecution(raw.money),
  };
}

/** The home, or null when the payload is not one this build can show. */
export function shapeHome(raw: unknown): PortalHome | null {
  const payload = asRow(raw);
  const delivery = asRow(payload?.delivery);
  if (!payload || !delivery) return null;
  const number = documentNumber('DE', delivery.number, delivery.year);
  const { entry_phase: entryPhase, phase } = delivery;
  if (!number || typeof entryPhase !== 'string' || !ENTRY_PHASES.has(entryPhase) || typeof phase !== 'string' || !PHASES.has(phase)) {
    return null;
  }
  const executionRow = asRow(payload.execution);
  const execution = phase === 'execution' && executionRow ? executionOf(executionRow) : null;
  if (execution === undefined) return null;
  const client = asRow(payload.client);
  const hint = boundedText(asRow(payload.code_channel)?.hint, HINT_MAX);
  return {
    delivery: {
      documentNumber: number,
      titleAr: boundedText(delivery.title_ar, TITLE_MAX),
      titleEn: boundedText(delivery.title_en, TITLE_MAX),
      entryPhase: entryPhase as EntryPhase,
      phase: phase as PhaseKey | 'closed',
    },
    firm: parseFirm(asRow(payload.firm) as FirmRow | null),
    client: { nameAr: textOrNull(client?.name_ar), nameEn: textOrNull(client?.name_en) },
    codeChannel: hint ? { hint } : null,
    execution,
  };
}
