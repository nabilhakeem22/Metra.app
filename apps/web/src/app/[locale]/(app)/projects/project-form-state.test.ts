import { describe, expect, it } from 'vitest';
import {
  canSaveProject,
  emptyProjectForm,
  locationFromClient,
  todayIsoLocal,
  withClient,
} from './project-form-state';
import type { ClientOption } from './types';

const CLIENTS: ClientOption[] = [
  { id: 'c-1', nameEn: 'Acme', nameAr: null, city: 'Giza', country: 'Egypt' },
  { id: 'c-2', nameEn: 'Nile', nameAr: null, city: 'Dubai', country: 'UAE' },
  { id: 'c-3', nameEn: 'Bare', nameAr: null, city: null, country: null },
];
const TODAY = '2026-10-06';
const EGYPT = 'Egypt';

describe('emptyProjectForm', () => {
  it('without a default client starts with NO client, today, no end date, active', () => {
    const form = emptyProjectForm(CLIENTS, undefined, TODAY, EGYPT);
    expect(form).toMatchObject({
      clientId: '',
      startDate: TODAY,
      endDate: '',
      status: 'active',
      city: '',
      country: EGYPT,
    });
  });

  it('opened from a client preselects it and takes its location', () => {
    const form = emptyProjectForm(CLIENTS, 'c-2', TODAY, EGYPT);
    expect(form).toMatchObject({ clientId: 'c-2', city: 'Dubai', country: 'UAE' });
  });

  it('ignores a default client that is not among the options', () => {
    expect(emptyProjectForm(CLIENTS, 'gone', TODAY, EGYPT).clientId).toBe('');
  });
});

describe('location from the client', () => {
  it('country defaults to the locale\'s Egypt when the client has none', () => {
    expect(locationFromClient(CLIENTS[2], EGYPT)).toEqual({ city: '', country: EGYPT });
  });

  it('picking a client fills city and country', () => {
    const form = withClient(emptyProjectForm(CLIENTS, undefined, TODAY, EGYPT), 'c-1', CLIENTS, EGYPT);
    expect(form).toMatchObject({ clientId: 'c-1', city: 'Giza', country: 'Egypt' });
  });

  it('a city the studio typed survives a later client change', () => {
    const typed = {
      ...withClient(emptyProjectForm(CLIENTS, undefined, TODAY, EGYPT), 'c-1', CLIENTS, EGYPT),
      city: 'New Cairo',
      locationEdited: true,
    };
    const changed = withClient(typed, 'c-2', CLIENTS, EGYPT);
    expect(changed).toMatchObject({ clientId: 'c-2', city: 'New Cairo', country: 'Egypt' });
  });
});

describe('canSaveProject', () => {
  const base = { ...emptyProjectForm(CLIENTS, 'c-1', TODAY, EGYPT), nameEn: 'Tower' };

  it('needs a name, a client and (on create) a start date', () => {
    expect(canSaveProject(base, true)).toBe(true);
    expect(canSaveProject({ ...base, nameEn: ' ' }, true)).toBe(false);
    expect(canSaveProject({ ...base, clientId: '' }, true)).toBe(false);
    expect(canSaveProject({ ...base, startDate: '' }, true)).toBe(false);
  });

  it('an edit may keep a legacy project without dates', () => {
    expect(canSaveProject({ ...base, startDate: '' }, false)).toBe(true);
  });
});

describe('todayIsoLocal', () => {
  it('formats the local calendar day', () => {
    expect(todayIsoLocal(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
