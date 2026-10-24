import { describe, expect, it } from 'vitest';
import { checkIn, checkOut, material, note, OTHER_ENGINEER, photo, queued, voidOf } from '@/test/site-outbox-records';
import { blobIdsOf, discardPlan, prerequisiteKeys } from './dependencies';

describe('prerequisiteKeys', () => {
  it('a check-in waits on nothing', () => {
    expect(prerequisiteKeys(checkIn('v1'))).toEqual([]);
  });

  it('every child of a visit waits on its check-in', () => {
    expect(prerequisiteKeys(note('n1', 'v1'))).toEqual(['v1']);
    expect(prerequisiteKeys(photo('p1', 'v1'))).toEqual(['v1']);
    expect(prerequisiteKeys(checkOut('o1', 'v1'))).toEqual(['v1']);
    expect(prerequisiteKeys(material('m1', 'v1'))).toEqual(['v1']);
  });

  it('a material with a photo also waits on that photo', () => {
    expect(prerequisiteKeys(material('m1', 'v1', 'p1'))).toEqual(['v1', 'p1']);
  });

  it('a void waits on the entry it voids', () => {
    expect(prerequisiteKeys(voidOf('x1', { kind: 'note', key: 'n1' }))).toEqual(['n1']);
  });
});

describe('blobIdsOf', () => {
  it('a photo owns its two copies; nothing else owns a blob', () => {
    expect(blobIdsOf(photo('p1', 'v1'))).toEqual(['p1-display', 'p1-thumb']);
    expect(blobIdsOf(note('n1', 'v1'))).toEqual([]);
  });
});

describe('discardPlan', () => {
  it('discarding a check-in removes its children, their dependents and their blobs (AC22)', () => {
    const visit = queued(checkIn('v1'));
    const shot = queued(photo('p1', 'v1'));
    const delivery = queued(material('m1', 'v1', 'p1'));
    const voidNote = queued(voidOf('x1', { kind: 'note', key: 'n1' }));
    const observation = queued(note('n1', 'v1'));
    const otherVisit = queued(checkIn('v2'));
    const otherNote = queued(note('n2', 'v2'));
    const plan = discardPlan([visit, shot, delivery, voidNote, observation, otherVisit, otherNote], visit.seq);
    expect(plan.seqs).toEqual([visit.seq, shot.seq, delivery.seq, voidNote.seq, observation.seq]);
    expect(plan.blobIds).toEqual(['p1-display', 'p1-thumb']);
  });

  it('discarding a child leaves its parent and its siblings', () => {
    const visit = queued(checkIn('v1'));
    const first = queued(note('n1', 'v1'));
    const second = queued(note('n2', 'v1'));
    expect(discardPlan([visit, first, second], first.seq)).toEqual({ seqs: [first.seq], blobIds: [] });
  });

  it("never reaches into another user's records", () => {
    const visit = queued(checkIn('v1'));
    const foreign = queued(note('n9', 'v1'), { userId: OTHER_ENGINEER });
    expect(discardPlan([visit, foreign], visit.seq).seqs).toEqual([visit.seq]);
  });

  it('an unknown seq discards nothing', () => {
    expect(discardPlan([queued(checkIn('v1'))], 9999)).toEqual({ seqs: [], blobIds: [] });
  });
});
