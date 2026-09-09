import { describe, expect, it } from 'vitest';
import { boqStepAction, boqStepHref } from './step';

describe('boqStepAction', () => {
  it('leads with building one when there is no BOQ', () => {
    expect(boqStepAction(null)).toBe('start');
  });

  it('treats an EMPTY BOQ as no BOQ', () => {
    // An empty document satisfies nothing and there is nothing to issue, so it
    // must not sit in the cockpit looking like progress.
    expect(boqStepAction({ id: 'b1', status: 'draft', lineCount: 0 })).toBe('start');
  });

  it('leads with issuing once lines exist', () => {
    expect(boqStepAction({ id: 'b1', status: 'draft', lineCount: 12 })).toBe('issue');
  });

  it('reports done once issued', () => {
    expect(boqStepAction({ id: 'b1', status: 'issued', lineCount: 12 })).toBe('done');
  });

  it('treats a superseded BOQ as done rather than re-offering issue', () => {
    // Superseded means a newer version took over; the step is not reopened by an
    // old document, and the guard is already satisfied by its artifact.
    expect(boqStepAction({ id: 'b1', status: 'superseded', lineCount: 5 })).toBe('done');
  });
});

describe('boqStepHref', () => {
  it('points at the project’s BOQ tab', () => {
    expect(boqStepHref('p1')).toBe('/projects/p1?tab=boq');
  });
});
