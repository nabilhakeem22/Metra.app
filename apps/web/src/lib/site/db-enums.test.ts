import {
  SITE_NOTE_KINDS as DB_SITE_NOTE_KINDS,
  SITE_PRESENCES as DB_SITE_PRESENCES,
  type SiteLocationStatus,
  type SitePhotoSource as DbSitePhotoSource,
} from '@metra/db';
import { describe, expect, it } from 'vitest';
import { SITE_NOTE_KINDS, type SitePhotoSource } from './outbox/types';
import { SITE_PRESENCES, type LocationStatus } from './presence';

// The site app's client-safe vocabularies (S1) and the Postgres enums of 0064
// (@metra/db) are two spellings of one contract: a label the phone sends that
// the enum lacks is a 22P02 on every insert, and a verdict the server stores
// that the app does not know renders nothing. The app keeps its own copies so
// client bundles never import the db layer; this proves the copies agree.

/** True only when A and B are the same union. */
type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe('site vocabularies match the 0064 enums', () => {
  it('presence verdicts and note kinds, label for label and in order', () => {
    expect([...SITE_PRESENCES]).toEqual([...DB_SITE_PRESENCES]);
    expect([...SITE_NOTE_KINDS]).toEqual([...DB_SITE_NOTE_KINDS]);
  });

  it('location statuses and photo sources, as types', () => {
    const locationStatuses: SameUnion<LocationStatus, SiteLocationStatus> = true;
    const photoSources: SameUnion<SitePhotoSource, DbSitePhotoSource> = true;
    expect([locationStatuses, photoSources]).toEqual([true, true]);
  });
});
