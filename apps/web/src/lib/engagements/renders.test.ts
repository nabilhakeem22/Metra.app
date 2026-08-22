import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeRenderManifestHash } from './renders';

/** The reference digest: identities sorted, newline-joined, sha256 hex. */
function referenceHash(identities: string[]): string {
  return createHash('sha256')
    .update([...identities].sort().join('\n'))
    .digest('hex');
}

describe('computeRenderManifestHash', () => {
  it('is order-independent — the SAME set hashes identically regardless of input order', () => {
    const forward = computeRenderManifestHash([
      { id: 'r1', contentHash: 'aaa' },
      { id: 'r2', contentHash: 'bbb' },
      { id: 'r3', contentHash: 'ccc' },
    ]);
    const shuffled = computeRenderManifestHash([
      { id: 'r3', contentHash: 'ccc' },
      { id: 'r1', contentHash: 'aaa' },
      { id: 'r2', contentHash: 'bbb' },
    ]);
    expect(forward).toBe(shuffled);
    expect(forward).toBe(referenceHash(['aaa', 'bbb', 'ccc']));
  });

  it('changes when a render content hash changes', () => {
    const before = computeRenderManifestHash([
      { id: 'r1', contentHash: 'aaa' },
      { id: 'r2', contentHash: 'bbb' },
    ]);
    const after = computeRenderManifestHash([
      { id: 'r1', contentHash: 'aaa' },
      { id: 'r2', contentHash: 'CHANGED' },
    ]);
    expect(after).not.toBe(before);
  });

  it('falls back to the artifact id when content_hash is null', () => {
    const withNull = computeRenderManifestHash([
      { id: 'r1', contentHash: null },
      { id: 'r2', contentHash: 'bbb' },
    ]);
    // The null-hash render contributes its id 'r1'; 'bbb' stands for the other.
    expect(withNull).toBe(referenceHash(['r1', 'bbb']));
  });

  it('a null content_hash and a content_hash equal to the id collide by design', () => {
    const viaNull = computeRenderManifestHash([{ id: 'r1', contentHash: null }]);
    const viaHash = computeRenderManifestHash([{ id: 'r1', contentHash: 'r1' }]);
    expect(viaNull).toBe(viaHash);
    expect(viaNull).toBe(referenceHash(['r1']));
  });

  it('a single render hashes its lone identity', () => {
    expect(computeRenderManifestHash([{ id: 'r1', contentHash: 'aaa' }])).toBe(
      referenceHash(['aaa']),
    );
  });
});
