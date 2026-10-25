import { describe, expect, it } from 'vitest';
import { checkIn, checkOut, ENGINEER, material, note, OTHER_ENGINEER, photo, queued, voidOf } from '@/test/site-outbox-records';
import { blobIdsOf, discardPlan, hardPrerequisiteKeys, prerequisiteKeys, recordsOnDependencyCycle } from './dependencies';

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

describe('hardPrerequisiteKeys', () => {
  it('a child cannot exist without its visit, nor a void without its target', () => {
    expect(hardPrerequisiteKeys(checkIn('v1'))).toEqual([]);
    expect(hardPrerequisiteKeys(note('n1', 'v1'))).toEqual(['v1']);
    expect(hardPrerequisiteKeys(voidOf('x1', { kind: 'photo', key: 'p1' }))).toEqual(['p1']);
  });

  it("a material's photo is optional: it is not a hard prerequisite", () => {
    expect(hardPrerequisiteKeys(material('m1', 'v1', 'p1'))).toEqual(['v1']);
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
    expect(plan.rewritten).toEqual([]);
  });

  it('discarding a child leaves its parent and its siblings', () => {
    const visit = queued(checkIn('v1'));
    const first = queued(note('n1', 'v1'));
    const second = queued(note('n2', 'v1'));
    expect(discardPlan([visit, first, second], first.seq)).toEqual({ seqs: [first.seq], blobIds: [], rewritten: [] });
  });

  it("never reaches into another user's records", () => {
    const visit = queued(checkIn('v1'));
    const foreign = queued(note('n9', 'v1'), { userId: OTHER_ENGINEER });
    expect(discardPlan([visit, foreign], visit.seq).seqs).toEqual([visit.seq]);
  });

  it('an unknown seq discards nothing', () => {
    expect(discardPlan([queued(checkIn('v1'))], 9999)).toEqual({ seqs: [], blobIds: [], rewritten: [] });
  });

  // F2 (S1 functional test): the material used to be discarded with its photo.
  it('discarding a photo keeps a material that showed it, rewritten without the photo', () => {
    const shot = queued(photo('p1', 'v1'), { state: 'needs_attention', lastError: { status: 422, code: 'photo_too_large' } });
    const delivery = queued(material('m1', 'v1', 'p1'));
    const unrelated = queued(material('m2', 'v1', 'p2'));
    expect(discardPlan([shot, delivery, unrelated], shot.seq)).toEqual({
      seqs: [shot.seq],
      blobIds: ['p1-display', 'p1-thumb'],
      rewritten: [{ ...delivery, op: material('m1', 'v1') }],
    });
  });

  it('discarding a photo also discards a void of it, which has nothing left to void', () => {
    const shot = queued(photo('p1', 'v1'));
    const voidShot = queued(voidOf('x1', { kind: 'photo', key: 'p1' }));
    expect(discardPlan([shot, voidShot], shot.seq).seqs).toEqual([shot.seq, voidShot.seq]);
  });

  // F6 (S1 functional test): a twin of the discarded record (one op stored twice) used to survive.
  it('removes every record carrying a discarded key, and each blob once', () => {
    const first = queued(note('dup', 'vd'));
    const twin = queued(note('dup', 'vd'));
    expect(discardPlan([first, twin], first.seq).seqs).toEqual([first.seq, twin.seq]);

    const visit = queued(checkIn('v1'));
    const shot = queued(photo('p1', 'v1'));
    const shotTwin = queued(photo('p1', 'v1'));
    const twinVisit = queued(checkIn('v1'));
    const records = [visit, shot, shotTwin, twinVisit];
    const plan = discardPlan(records, shotTwin.seq);
    expect(plan.seqs).toEqual([shot.seq, shotTwin.seq]);
    expect(plan.blobIds).toEqual(['p1-display', 'p1-thumb']);
    expect(discardPlan(records, twinVisit.seq).seqs).toEqual([visit.seq, shot.seq, shotTwin.seq, twinVisit.seq]);
  });
});

// F5 (S1 functional test): these used to wait for ever, shown as "queued".
describe('recordsOnDependencyCycle', () => {
  it('finds a self-reference', () => {
    const selfVoid = queued(voidOf('vv', { kind: 'note', key: 'vv' }));
    expect(recordsOnDependencyCycle([selfVoid, queued(checkIn('v1'))], ENGINEER)).toEqual([selfVoid]);
  });

  it('finds every member of a cycle, soft links included, and not the ops that merely wait on one', () => {
    const looped = queued(note('nc', 'vc'));
    const loopBack = queued(voidOf('vc', { kind: 'note', key: 'nc' }));
    const waitsOnLoop = queued(voidOf('x9', { kind: 'note', key: 'nc' }));
    const throughPhoto = queued(material('mc', 'v1', 'pc'));
    const photoBack = queued(photo('pc', 'mc'));
    expect(recordsOnDependencyCycle([looped, loopBack, waitsOnLoop, throughPhoto, photoBack], ENGINEER)).toEqual([
      looped,
      loopBack,
      throughPhoto,
      photoBack,
    ]);
  });

  it('finds none in well-formed ops, and never looks at another user', () => {
    const wellFormed = [
      queued(checkIn('v1')),
      queued(photo('p1', 'v1')),
      queued(material('m1', 'v1', 'p1')),
      queued(voidOf('x1', { kind: 'material', key: 'm1' })),
    ];
    expect(recordsOnDependencyCycle(wellFormed, ENGINEER)).toEqual([]);
    const foreign = queued(voidOf('vv', { kind: 'note', key: 'vv' }), { userId: OTHER_ENGINEER });
    expect(recordsOnDependencyCycle([foreign], ENGINEER)).toEqual([]);
  });
});
