import { describe, expect, it } from 'vitest';
import {
  CLIENT_RELEASES,
  selectReleaseArtifactIds,
  type ClientReleaseKey,
  type ReleasableArtifact,
} from './client-release';
import { CATEGORY_WRITE_KIND } from './deliverable-files';
import type { EngagementArtifactKind } from '@metra/db';

const RELEASE_KEYS: ClientReleaseKey[] = [
  'conceptPackage',
  'designPackage',
  'handoverPackage',
];

let counter = 0;
function artifact(
  id: string,
  kind: EngagementArtifactKind,
  opts: { fileId?: string | null; attestedAt?: string } = {},
): ReleasableArtifact {
  counter += 1;
  return {
    id,
    kind,
    fileId: opts.fileId === undefined ? `file-${counter}` : opts.fileId,
    attestedAt: new Date(opts.attestedAt ?? '2026-01-01T00:00:00Z'),
  };
}

describe('client release table', () => {
  it('declares exactly the three release points', () => {
    expect(Object.keys(CLIENT_RELEASES).sort()).toEqual([...RELEASE_KEYS].sort());
  });

  it('NEVER auto-releases a boq from any release point', () => {
    for (const key of RELEASE_KEYS) {
      const release = CLIENT_RELEASES[key];
      expect(release.allOf).not.toContain('boq');
      expect(release.latestOf).not.toContain('boq');
    }
  });

  // A site survey is INTERNAL. It used to be excluded incidentally as well as by
  // this table — the artifact panel attaches no file, so `hasFile` dropped it. The
  // survey command-card dropzone ends that: an uploaded survey now carries a
  // fileId and is release-eligible in every respect EXCEPT this table. So assert
  // both the table AND the kind the survey upload category actually writes.
  it('never auto-releases a survey either (internal spatial base)', () => {
    for (const key of RELEASE_KEYS) {
      const release = CLIENT_RELEASES[key];
      expect(release.allOf).not.toContain('survey');
      expect(release.latestOf).not.toContain('survey');
      expect(release.allOf).not.toContain(CATEGORY_WRITE_KIND.survey);
      expect(release.latestOf).not.toContain(CATEGORY_WRITE_KIND.survey);
    }
  });

  it('never selects a FILE-BEARING survey from any release point', () => {
    const rows = [artifact('s-file', 'survey', { fileId: 'f-survey' })];
    for (const key of RELEASE_KEYS) {
      expect(selectReleaseArtifactIds(CLIENT_RELEASES[key], rows)).toEqual([]);
    }
  });

  it('conceptPackage = every concept option + the newest autocad only', () => {
    expect(CLIENT_RELEASES.conceptPackage).toEqual({
      allOf: ['concept_option'],
      latestOf: ['autocad'],
    });
    expect(CLIENT_RELEASES.designPackage).toEqual({
      allOf: ['approved_render'],
      latestOf: [],
    });
    expect(CLIENT_RELEASES.handoverPackage).toEqual({
      allOf: ['shop_drawing'],
      latestOf: [],
    });
  });
});

describe('selectReleaseArtifactIds', () => {
  it('returns [] for an empty artifact list', () => {
    for (const key of RELEASE_KEYS) {
      expect(selectReleaseArtifactIds(CLIENT_RELEASES[key], [])).toEqual([]);
    }
  });

  it('selects every file-bearing allOf artifact and the newest latestOf one', () => {
    const rows = [
      artifact('c1', 'concept_option'),
      artifact('c2', 'concept_option'),
      artifact('a-old', 'autocad', { attestedAt: '2026-01-01T00:00:00Z' }),
      artifact('a-new', 'autocad', { attestedAt: '2026-03-01T00:00:00Z' }),
    ];
    expect(selectReleaseArtifactIds(CLIENT_RELEASES.conceptPackage, rows)).toEqual([
      'a-new',
      'c1',
      'c2',
    ]);
  });

  it('ignores artifacts that carry no file', () => {
    const rows = [
      artifact('c1', 'concept_option', { fileId: null }),
      artifact('c2', 'concept_option', { fileId: '' }),
      artifact('c3', 'concept_option'),
      artifact('a1', 'autocad', { fileId: null }),
    ];
    expect(selectReleaseArtifactIds(CLIENT_RELEASES.conceptPackage, rows)).toEqual([
      'c3',
    ]);
  });

  // The point of the `conceptOption` upload category: a concept option recorded
  // through the command card now CARRIES A FILE, so conceptPackage actually
  // reaches the client. Before it, the only way to make a `concept_option` was
  // the metadata-only artifact panel, and every such record was silently dropped
  // by the hasFile filter — the studio advanced and the client saw nothing.
  it('releases file-bearing concept options with no autocad in the engagement', () => {
    const rows = [
      artifact('option-a', 'concept_option', { fileId: 'file-a' }),
      artifact('option-b', 'concept_option', { fileId: 'file-b' }),
    ];
    expect(selectReleaseArtifactIds(CLIENT_RELEASES.conceptPackage, rows)).toEqual([
      'option-a',
      'option-b',
    ]);
  });

  it('picks the newest FILE-BEARING autocad, not a newer fileless one', () => {
    const rows = [
      artifact('a-old', 'autocad', { attestedAt: '2026-01-01T00:00:00Z' }),
      artifact('a-newest-fileless', 'autocad', {
        attestedAt: '2026-06-01T00:00:00Z',
        fileId: null,
      }),
    ];
    expect(selectReleaseArtifactIds(CLIENT_RELEASES.conceptPackage, rows)).toEqual([
      'a-old',
    ]);
  });

  // TRIPWIRE (S4): `autocad` backs BOTH the studio's 2D layout and a developer /
  // consultant CAD import. The import is excluded today ONLY because that UI path
  // attaches no file. These two cases pin both halves of that accident, so adding
  // file attachment to the artifact panel fails here and forces a provenance
  // discriminator rather than silently auto-publishing a developer's drawings.
  it('TRIPWIRE: a fileless autocad is never released, however new it is', () => {
    const rows = [
      artifact('a-developer-import', 'autocad', {
        attestedAt: '2026-12-01T00:00:00Z',
        fileId: null,
      }),
      artifact('c1', 'concept_option'),
      artifact('c2', 'concept_option'),
    ];
    const ids = selectReleaseArtifactIds(CLIENT_RELEASES.conceptPackage, rows);
    expect(ids).not.toContain('a-developer-import');
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('TRIPWIRE: releases ONLY the newest file-bearing autocad, never an older one', () => {
    const rows = [
      artifact('a-oldest', 'autocad', { attestedAt: '2026-01-01T00:00:00Z' }),
      artifact('a-middle', 'autocad', { attestedAt: '2026-02-01T00:00:00Z' }),
      artifact('a-newest', 'autocad', { attestedAt: '2026-03-01T00:00:00Z' }),
    ];
    const ids = selectReleaseArtifactIds(CLIENT_RELEASES.conceptPackage, rows);
    expect(ids).toEqual(['a-newest']);
    expect(ids).not.toContain('a-oldest');
    expect(ids).not.toContain('a-middle');
  });

  it('is stable regardless of input order', () => {
    const rows = [
      artifact('c1', 'concept_option'),
      artifact('a-old', 'autocad', { attestedAt: '2026-01-01T00:00:00Z' }),
      artifact('a-new', 'autocad', { attestedAt: '2026-03-01T00:00:00Z' }),
      artifact('c2', 'concept_option'),
    ];
    const forward = selectReleaseArtifactIds(CLIENT_RELEASES.conceptPackage, rows);
    const reversed = selectReleaseArtifactIds(
      CLIENT_RELEASES.conceptPackage,
      [...rows].reverse(),
    );
    expect(reversed).toEqual(forward);
  });

  it('breaks an attestedAt tie deterministically (smallest id wins)', () => {
    const rows = [
      artifact('a-zzz', 'autocad', { attestedAt: '2026-02-01T00:00:00Z' }),
      artifact('a-aaa', 'autocad', { attestedAt: '2026-02-01T00:00:00Z' }),
    ];
    expect(selectReleaseArtifactIds(CLIENT_RELEASES.conceptPackage, rows)).toEqual([
      'a-aaa',
    ]);
    expect(
      selectReleaseArtifactIds(CLIENT_RELEASES.conceptPackage, [...rows].reverse()),
    ).toEqual(['a-aaa']);
  });

  it('never selects a boq or a survey, even when both sit in the same engagement', () => {
    const rows = [
      artifact('c1', 'concept_option'),
      artifact('b1', 'boq'),
      artifact('s1', 'survey'),
      artifact('r1', 'approved_render'),
      artifact('d1', 'shop_drawing'),
    ];
    for (const key of RELEASE_KEYS) {
      const ids = selectReleaseArtifactIds(CLIENT_RELEASES[key], rows);
      expect(ids).not.toContain('b1');
      expect(ids).not.toContain('s1');
    }
    expect(selectReleaseArtifactIds(CLIENT_RELEASES.designPackage, rows)).toEqual([
      'r1',
    ]);
    expect(selectReleaseArtifactIds(CLIENT_RELEASES.handoverPackage, rows)).toEqual([
      'd1',
    ]);
  });

  it('deduplicates when a kind is both allOf and latestOf', () => {
    const rows = [
      artifact('x1', 'concept_option', { attestedAt: '2026-01-01T00:00:00Z' }),
      artifact('x2', 'concept_option', { attestedAt: '2026-02-01T00:00:00Z' }),
    ];
    const ids = selectReleaseArtifactIds(
      { allOf: ['concept_option'], latestOf: ['concept_option'] },
      rows,
    );
    expect(ids).toEqual(['x1', 'x2']);
  });
});
