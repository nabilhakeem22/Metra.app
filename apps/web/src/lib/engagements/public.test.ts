import { afterEach, describe, expect, it, vi } from 'vitest';

// getDeliveryByToken is server-only and runs the token SDF over withRequestDb.
// Stub `server-only` and replace the DB layer with an in-memory handle so the
// HARDENING (try/catch + null-safe mapping) can be exercised with MALFORMED
// snapshots — no real socket, no `@/` alias needed (the only `@/` import,
// `@/lib/db/client`, is mocked here).
const dbState = vi.hoisted(() => ({
  rows: [] as Array<{ data: unknown }>,
  throwOnCall: false,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db/client', () => ({
  withRequestDb: async () => {
    if (dbState.throwOnCall) throw new Error('db exploded');
    return dbState.rows;
  },
}));

const { getDeliveryByToken } = await import('./public');

/** A fully-valid snapshot; each test corrupts one field to prove graceful decay. */
function validSnapshot(): Record<string, unknown> {
  return {
    id: 'de-1',
    number: 7,
    state: 'concept_review',
    off_plan: false,
    title_ar: 'شقة',
    title_en: 'Apartment',
    created_at: '2026-01-01T00:00:00Z',
    design_fee_total: '50000.0000',
    rom: { low: '100000.0000', high: '150000.0000' },
    share_expires_at: null,
    firm: { name_ar: 'ديوان', name_en: 'Diwan', logo_file_id: null },
    client: { name_ar: 'أحمد', name_en: 'Ahmed' },
    payment_schedule: [
      { milestone_kind: 'deposit', basis: 'x', amount_due: '10000.0000', amount_cleared: '0', status: 'paid' },
    ],
    client_actions: ['approve_concept', 'request_concept_changes'],
  };
}

function setSnapshot(snapshot: unknown): void {
  dbState.throwOnCall = false;
  dbState.rows = [{ data: snapshot }];
}

afterEach(() => {
  dbState.throwOnCall = false;
  dbState.rows = [];
  vi.restoreAllMocks();
});

describe('getDeliveryByToken hardening', () => {
  it('maps a fully-valid snapshot', async () => {
    setSnapshot(validSnapshot());
    const result = await getDeliveryByToken('raw-token');
    expect(result).not.toBeNull();
    expect(result?.number).toBe(7);
    expect(result?.firm.nameEn).toBe('Diwan');
    expect(result?.clientActions).toEqual(['approve_concept', 'request_concept_changes']);
  });

  it('returns null (no throw) when the DB/SDF call itself throws', async () => {
    dbState.throwOnCall = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(getDeliveryByToken('raw-token')).resolves.toBeNull();
    // Breadcrumb logged, but NEVER the raw token.
    expect(errorSpy).toHaveBeenCalledWith('delivery read failed', { hasSnapshot: false });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('raw-token');
  });

  it('returns null for an empty/whitespace token without touching the DB', async () => {
    dbState.throwOnCall = true; // would throw if reached
    await expect(getDeliveryByToken('   ')).resolves.toBeNull();
  });

  it('returns null when the SDF returns no snapshot', async () => {
    setSnapshot(null);
    await expect(getDeliveryByToken('raw-token')).resolves.toBeNull();
  });

  it('returns null for an unknown machine state (never renders a raw key)', async () => {
    setSnapshot({ ...validSnapshot(), state: 'not_a_real_state' });
    await expect(getDeliveryByToken('raw-token')).resolves.toBeNull();
  });

  it('returns null when state is missing entirely', async () => {
    const snapshot = validSnapshot();
    delete snapshot.state;
    setSnapshot(snapshot);
    await expect(getDeliveryByToken('raw-token')).resolves.toBeNull();
  });

  it('degrades a MISSING firm to null fields instead of throwing', async () => {
    const snapshot = validSnapshot();
    delete snapshot.firm;
    setSnapshot(snapshot);
    const result = await getDeliveryByToken('raw-token');
    expect(result).not.toBeNull();
    expect(result?.firm).toEqual({ nameAr: null, nameEn: null, logoFileId: null });
  });

  it('degrades a NULL client to null fields instead of throwing', async () => {
    setSnapshot({ ...validSnapshot(), client: null });
    const result = await getDeliveryByToken('raw-token');
    expect(result).not.toBeNull();
    expect(result?.client).toEqual({ nameAr: null, nameEn: null });
  });

  it('coerces a NON-ARRAY payment schedule to an empty list', async () => {
    setSnapshot({ ...validSnapshot(), payment_schedule: 'not-an-array' });
    const result = await getDeliveryByToken('raw-token');
    expect(result?.paymentSchedule).toEqual([]);
  });

  it('drops malformed schedule rows (missing status / amount_due)', async () => {
    setSnapshot({
      ...validSnapshot(),
      payment_schedule: [
        { milestone_kind: 'deposit', amount_due: '10000.0000', status: 'paid', basis: 'x', amount_cleared: '0' },
        { milestone_kind: 'gate_a' }, // no status, no amount_due
        { status: 'due', amount_due: '5000.0000' }, // no milestone_kind
        { milestone_kind: 'gate_b', status: 'weird', amount_due: '1' }, // unknown status
      ],
    });
    const result = await getDeliveryByToken('raw-token');
    expect(result?.paymentSchedule).toHaveLength(1);
    expect(result?.paymentSchedule[0].milestone_kind).toBe('deposit');
  });

  it('filters unknown verbs out of clientActions (6-verb whitelist)', async () => {
    setSnapshot({
      ...validSnapshot(),
      client_actions: ['approve_concept', 'delete_everything', 'acknowledge_rom'],
    });
    const result = await getDeliveryByToken('raw-token');
    expect(result?.clientActions).toEqual(['approve_concept', 'acknowledge_rom']);
  });

  it('coerces a NON-ARRAY client_actions to an empty list', async () => {
    setSnapshot({ ...validSnapshot(), client_actions: { hax: true } });
    const result = await getDeliveryByToken('raw-token');
    expect(result?.clientActions).toEqual([]);
  });

  it('falls back a non-finite number to 0 when the id is still valid', async () => {
    setSnapshot({ ...validSnapshot(), number: 'abc' });
    const result = await getDeliveryByToken('raw-token');
    expect(result).not.toBeNull();
    expect(result?.number).toBe(0);
  });

  it('returns null when BOTH id and number are unusable', async () => {
    setSnapshot({ ...validSnapshot(), id: '', number: null });
    await expect(getDeliveryByToken('raw-token')).resolves.toBeNull();
  });

  it('degrades a null created_at without throwing', async () => {
    setSnapshot({ ...validSnapshot(), created_at: null });
    const result = await getDeliveryByToken('raw-token');
    expect(result).not.toBeNull();
    expect(result?.createdAt).toBeNull();
  });

  it('never throws across a battery of hostile snapshots', async () => {
    const hostile: unknown[] = [
      undefined,
      42,
      'string',
      [],
      {},
      { state: 'concept_review' },
      { id: 'x', number: 1, state: 'concept_review', firm: 5, client: 'nope', rom: 3, payment_schedule: 9, client_actions: 'x' },
    ];
    for (const snapshot of hostile) {
      setSnapshot(snapshot);
      // Resolving (to a value or null) rather than rejecting is the whole point.
      await expect(getDeliveryByToken('raw-token')).resolves.toBeDefined();
    }
  });
});
