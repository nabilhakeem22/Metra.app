import { describe, expect, it } from 'vitest';
import type { EngagementArtifactKind } from '@metra/db';
import type { EngagementArtifactRecord } from './queries';
import { deriveWorkingFiles } from './working-files';

function artifact(
  kind: EngagementArtifactKind,
  attestedAt: string,
  overrides: Partial<EngagementArtifactRecord> = {},
): EngagementArtifactRecord {
  return {
    id: `${kind}-${attestedAt}`,
    kind,
    fileId: null,
    contentHash: null,
    label: null,
    attestedBy: 'user-1',
    attestedAt: new Date(attestedAt),
    note: null,
    clientVisible: false,
    ...overrides,
  };
}

describe('deriveWorkingFiles', () => {
  it('returns the three categories in tray order, all empty for no artifacts', () => {
    const rows = deriveWorkingFiles([]);
    expect(rows.map((r) => r.category)).toEqual(['layout', 'render', 'boq']);
    for (const row of rows) {
      expect(row.latest).toBeNull();
      expect(row.version).toBe(0);
      expect(row.hasFile).toBe(false);
    }
  });

  it('picks the newest attested artifact per category regardless of input order', () => {
    const older = artifact('concept_option', '2026-01-01T00:00:00Z');
    const newer = artifact('concept_option', '2026-03-01T00:00:00Z');
    // Input deliberately oldest-first to prove it does not rely on order.
    const rows = deriveWorkingFiles([older, newer]);
    const layout = rows.find((r) => r.category === 'layout');
    expect(layout?.latest?.id).toBe(newer.id);
    expect(layout?.version).toBe(2);
  });

  it('maps autocad into the layout category too', () => {
    const rows = deriveWorkingFiles([
      artifact('autocad', '2026-02-01T00:00:00Z'),
    ]);
    const layout = rows.find((r) => r.category === 'layout');
    expect(layout?.latest).not.toBeNull();
    expect(layout?.version).toBe(1);
  });

  it('flags hasFile only when the latest artifact carries a fileId', () => {
    const rows = deriveWorkingFiles([
      artifact('approved_render', '2026-02-01T00:00:00Z', { fileId: 'f-1' }),
      artifact('boq', '2026-02-01T00:00:00Z'),
    ]);
    expect(rows.find((r) => r.category === 'render')?.hasFile).toBe(true);
    expect(rows.find((r) => r.category === 'boq')?.hasFile).toBe(false);
  });

  it('ignores kinds outside the three working-file categories', () => {
    const rows = deriveWorkingFiles([
      artifact('survey', '2026-02-01T00:00:00Z'),
      artifact('shop_drawing', '2026-02-01T00:00:00Z'),
    ]);
    for (const row of rows) {
      expect(row.latest).toBeNull();
      expect(row.version).toBe(0);
    }
  });
});
