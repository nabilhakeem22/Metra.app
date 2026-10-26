// TEST-ONLY. The client home's token payload (app_home_by_token) as the SQL
// writes it, one per client execution reason, so the reader's mapping and the
// Execution tab's rendering are checked against the SAME payloads. Each fact
// source is the smallest one the cockpit's derivation places on that reason
// (lib/flow/locate/execution-client.ts).
import type { ClientExecutionReason } from '@/lib/flow/locate/execution-client';

type Json = Record<string, unknown>;

export const CONTRACT_ID = '00000000-0000-4000-8000-0000000000c1';
const REQUEST_ID = '00000000-0000-4000-8000-0000000000a1';
const FINAL_ID = '00000000-0000-4000-8000-0000000000f1';

const NO_MONEY = {
  pending_claims: 0,
  unpaid_requests: 0,
  unclaimed_due_requests: 0,
  open_variations: 0,
  issued_variations: 0,
  expired_variations: 0,
  unbilled_variations: 0,
  issued_total: '0',
  approved_deltas: [],
  billed_milestones: [],
  final_account: null,
};

function sourceContract(status: string, over: Json = {}): Json {
  return {
    id: CONTRACT_ID,
    number: 4,
    created_at: '2026-10-01T08:00:00.000Z',
    status,
    signing_open: false,
    original_value: '100000.0000',
    tax_amount: '14000.0000',
    tax_rate: '14.0000',
    supervision_pct: '0.0000',
    discount_pct: '0.0000',
    schedule: [],
    money: null,
    measured_works: null,
    ...over,
  };
}

const signed = (money: Json, over: Json = {}) =>
  sourceContract('signed', { money: { ...NO_MONEY, ...money }, measured_works: '0', ...over });

const finalAccount = (outstanding: string, finalValue: string) => ({ outstanding, final_value: finalValue });

/** The fact source per reason: the smallest one each reason stands on. */
const FLOW_SOURCE: Readonly<Record<ClientExecutionReason, Json>> = {
  preparing_contract: { issued_boq_id: null, contract: null },
  sign_contract: { issued_boq_id: 'b', contract: sourceContract('issued', { signing_open: true }) },
  signing_closed: { issued_boq_id: 'b', contract: sourceContract('issued') },
  decide_change_order: { issued_boq_id: 'b', contract: signed({ open_variations: 1, issued_variations: 1 }) },
  pay_request: { issued_boq_id: 'b', contract: signed({ unpaid_requests: 1, unclaimed_due_requests: 1, issued_total: '57000' }) },
  payment_being_confirmed: {
    issued_boq_id: 'b',
    contract: signed({ unpaid_requests: 1, pending_claims: 1, issued_total: '57000' }),
  },
  works_in_progress: { issued_boq_id: 'b', contract: signed({}) },
  final_account_due: {
    issued_boq_id: 'b',
    contract: signed({ unpaid_requests: 1, unclaimed_due_requests: 1, issued_total: '114000', final_account: finalAccount('1500.5000', '114000') }, { measured_works: null }),
  },
  final_account_in_review: {
    issued_boq_id: 'b',
    contract: signed({ issued_total: '114000', final_account: finalAccount('0', '115000') }, { measured_works: null }),
  },
  settled: {
    issued_boq_id: 'b',
    contract: signed({ issued_total: '114000', final_account: finalAccount('0', '114000') }, { measured_works: null }),
  },
  terminated: { issued_boq_id: 'b', contract: sourceContract('terminated') },
};

const CONTRACT_STATUS: Readonly<Record<ClientExecutionReason, string | null>> = {
  preparing_contract: null,
  sign_contract: 'issued',
  signing_closed: 'issued',
  decide_change_order: 'signed',
  pay_request: 'signed',
  payment_being_confirmed: 'signed',
  works_in_progress: 'signed',
  final_account_due: 'signed',
  final_account_in_review: 'signed',
  settled: 'signed',
  terminated: 'terminated',
};

function requestRow(over: Json): Json {
  return {
    id: REQUEST_ID,
    number: 3,
    year: 2026,
    kind: 'milestone',
    label_ar: 'دفعة مقدمة',
    label_en: 'Advance',
    variation_number: null,
    variation_year: null,
    amount: '57000.0000',
    issued_on: '2026-10-05',
    due_on: '2026-10-20',
    paid: '0.0000',
    outstanding: '57000.0000',
    status: 'issued',
    has_pending_claim: false,
    claimed_at: null,
    ...over,
  };
}

/** The requests the money card carries per reason: the ones its hero names. */
function requestsFor(reason: ClientExecutionReason): Json[] {
  switch (reason) {
    case 'pay_request':
      return [requestRow({})];
    case 'payment_being_confirmed':
      return [requestRow({ has_pending_claim: true, claimed_at: '2026-10-21T09:00:00.000Z' })];
    case 'final_account_due':
      return [
        requestRow({ id: FINAL_ID, number: 9, kind: 'final_account', label_ar: null, label_en: null, amount: '1500.5000', outstanding: '1500.5000' }),
        requestRow({ paid: '57000.0000', outstanding: '0.0000' }),
      ];
    default:
      return [];
  }
}

function moneyFor(reason: ClientExecutionReason): Json | null {
  const status = CONTRACT_STATUS[reason];
  if (status === null) return null;
  return {
    contract: { number: 4, year: 2026, status, title_ar: 'فيلا الشريف', title_en: 'El Sherif Villa', original_value: '114000.0000' },
    requests: requestsFor(reason),
    requests_truncated: false,
    receipts: [{ amount: '57000.0000', received_on: '2026-10-22', request_number: 3, request_year: 2026 }],
    receipts_truncated: false,
    earlier_claims: [],
    payment_details: {
      instapay: 'noon.studio@instapay',
      bank_name: 'البنك الأهلي المصري',
      bank_account_holder: 'استوديو نون للتصميم',
      bank_account_number: '1903 0710 0045 2816',
      bank_iban: null,
    },
  };
}

function homeContract(reason: ClientExecutionReason): Json | null {
  const status = CONTRACT_STATUS[reason];
  if (status === null) return null;
  return {
    id: CONTRACT_ID,
    number: 4,
    year: 2026,
    status,
    signing_open: reason === 'sign_contract',
    signed: status === 'issued' ? null : { on: '2026-10-03', via: 'online' },
    terminated_at: status === 'terminated' ? '2026-10-25T10:00:00.000Z' : null,
    end_date: '2027-02-28',
    time_extension_days_total: 14,
  };
}

/** The home payload of a delivery at `execution` on `reason`. */
export function homePayload(reason: ClientExecutionReason, over: { entryPhase?: 'design' | 'execution'; codeChannel?: Json | null } = {}): Json {
  return {
    delivery: {
      number: 12,
      year: 2026,
      title_ar: 'فيلا الشريف',
      title_en: 'El Sherif Villa',
      entry_phase: over.entryPhase ?? 'design',
      phase: 'execution',
      created_at: '2026-06-01T08:00:00.000Z',
    },
    firm: { name_ar: 'استوديو نون', name_en: 'Noon Studio', logo_file_id: null, phone: '+201000000001', whatsapp: '+201000000002' },
    client: { name_ar: 'هشام الشريف', name_en: 'Hesham El Sherif' },
    code_channel: over.codeChannel === undefined ? { hint: 'h•••@e•••.com' } : over.codeChannel,
    execution: {
      contract: homeContract(reason),
      previous_contract: null,
      flow_source: FLOW_SOURCE[reason],
      money: moneyFor(reason),
    },
  };
}
