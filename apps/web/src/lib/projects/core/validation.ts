// Shared project-input validation + the in-tx client-usability check. The
// client-existence check runs inside the tx; the composite same-org FK is the DB
// backstop for a cross-org client_id. `ProjectInput` is the one public name here;
// the rest are internal helpers create/update compose (NOT re-exported by the
// `@/lib/projects/core` barrel).
import { clients, PROJECT_STATUSES, type MetraDb, type ProjectStatus } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { isUuid } from '@/lib/uuid';

export interface ProjectInput {
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
  clientId: string;
  typeId?: string | null;
  status: ProjectStatus;
  description?: string | null;
  advancePct?: string | null;
  retentionPct?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
}

function isStatus(v: unknown): v is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(v as string);
}

const PCT_RE = /^\d+(\.\d+)?$/;

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

/** Non-negative percentage in [0,100] as a decimal string, or null if invalid. */
function normPct(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (s === undefined || s === '') return '0';
  if (!PCT_RE.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return s;
}

// Boundary length caps (defense-in-depth), mirroring org/core profileWithinLimits.
const LIMITS = {
  code: 64,
  name: 200,
  city: 120,
  address: 300,
  notes: 2000,
  description: 4000,
} as const;

export interface Validated {
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  clientId: string;
  typeId: string | null;
  status: ProjectStatus;
  description: string | null;
  advancePct: string;
  retentionPct: string;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  address: string | null;
  notes: string | null;
}

// Shared field validation -> a coded error or the normalized row.
export function validate(input: ProjectInput): ActionResult | Validated {
  const code = input.code?.trim();
  if (!code) return err('code_required');
  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  if (!nameEn && !nameAr) return err('name_required');
  if (!isStatus(input.status)) return err('invalid');
  // A missing OR malformed client id -> client_required (no DB uuid-cast throw).
  const clientId = input.clientId?.trim();
  if (!clientId || !isUuid(clientId)) return err('client_required');

  // Type is optional; if present it must be a uuid (in-org enforced by the FK).
  const typeId = clean(input.typeId);
  if (typeId && !isUuid(typeId)) return err('invalid');

  const advancePct = normPct(input.advancePct);
  const retentionPct = normPct(input.retentionPct);
  if (advancePct === null || retentionPct === null) return err('invalid');

  const startDate = clean(input.startDate);
  const endDate = clean(input.endDate);
  // Compare chronologically (not lexically) so non-zero-padded dates still order.
  if (startDate && endDate) {
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e < s) {
      return err('invalid_dates');
    }
  }

  const city = clean(input.city);
  const address = clean(input.address);
  const notes = clean(input.notes);
  const description = clean(input.description);
  if (
    code.length > LIMITS.code ||
    (nameEn?.length ?? 0) > LIMITS.name ||
    (nameAr?.length ?? 0) > LIMITS.name ||
    (city?.length ?? 0) > LIMITS.city ||
    (address?.length ?? 0) > LIMITS.address ||
    (notes?.length ?? 0) > LIMITS.notes ||
    (description?.length ?? 0) > LIMITS.description
  ) {
    return err('invalid');
  }

  return {
    code,
    nameEn,
    nameAr,
    clientId,
    typeId,
    status: input.status,
    description,
    advancePct,
    retentionPct,
    startDate,
    endDate,
    city,
    address,
    notes,
  };
}

export function isErr(v: ActionResult | Validated): v is ActionResult {
  return 'ok' in v;
}

// The client must exist AND be active in THIS org (RLS scopes the read).
export async function assertClientUsable(
  tx: MetraDb,
  clientId: string,
): Promise<void> {
  const [client] = await tx
    .select({ id: clients.id, active: clients.active })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client || !client.active) fail('client_required');
}
