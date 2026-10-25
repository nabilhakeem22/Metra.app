import { describe, expect, it } from 'vitest';
import { sitePhotoObjectKey } from './photo-object-key';

const ids = {
  orgId: '00000000-0000-4000-8000-00000000000a',
  projectId: '00000000-0000-4000-8000-0000000000a3',
  photoId: '60000000-0000-4000-8000-000000000001',
};

describe('sitePhotoObjectKey', () => {
  it('derives the display and the thumbnail key from the studio, the project and the photo', () => {
    expect(sitePhotoObjectKey(ids, 'display')).toBe(
      '00000000-0000-4000-8000-00000000000a/site/00000000-0000-4000-8000-0000000000a3/60000000-0000-4000-8000-000000000001-d.jpg',
    );
    expect(sitePhotoObjectKey(ids, 'thumb')).toBe(
      '00000000-0000-4000-8000-00000000000a/site/00000000-0000-4000-8000-0000000000a3/60000000-0000-4000-8000-000000000001-t.jpg',
    );
  });

  it('writes the ids in lower case, as Postgres writes a uuid', () => {
    const upper = { orgId: ids.orgId.toUpperCase(), projectId: ids.projectId.toUpperCase(), photoId: 'ABCDEF00-0000-4000-8000-00000000000F' };
    expect(sitePhotoObjectKey(upper, 'display')).toBe(
      '00000000-0000-4000-8000-00000000000a/site/00000000-0000-4000-8000-0000000000a3/abcdef00-0000-4000-8000-00000000000f-d.jpg',
    );
  });

  it('refuses an id that is not a uuid, so no key can climb out of its prefix', () => {
    for (const bad of ['', '../other', `${ids.photoId}/x`, 'not-a-uuid']) {
      expect(() => sitePhotoObjectKey({ ...ids, photoId: bad }, 'display'), bad).toThrow(RangeError);
      expect(() => sitePhotoObjectKey({ ...ids, projectId: bad }, 'thumb'), bad).toThrow(RangeError);
    }
  });
});
