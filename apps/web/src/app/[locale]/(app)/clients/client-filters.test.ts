import { describe, expect, test } from 'vitest';
import { cityOptions, filterClients, type ClientFilter } from './client-filters';
import type { ClientRow } from './types';

function client(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    id: 'c-1',
    nameEn: 'Nile Interiors',
    nameAr: 'النيل للديكور',
    contactName: 'Mona',
    email: 'mona@nile.example',
    phone: '+201000000000',
    city: 'Cairo',
    country: 'EG',
    address: null,
    taxRegistrationNumber: null,
    notes: null,
    active: true,
    type: 'company',
    projectCount: 3,
    ...overrides,
  };
}

const ALL: ClientFilter = { query: '', status: 'all', city: 'all' };
const ids = (rows: ClientRow[]) => rows.map((row) => row.id);

describe('filterClients — the resting state', () => {
  test('all/all/empty returns everything, in order', () => {
    const items = [client({ id: 'a' }), client({ id: 'b', active: false })];
    expect(ids(filterClients(items, ALL))).toEqual(['a', 'b']);
  });

  test('a whitespace-only query is not a filter', () => {
    const items = [client({ id: 'a' })];
    expect(ids(filterClients(items, { ...ALL, query: '   ' }))).toEqual(['a']);
  });
});

describe('filterClients — status', () => {
  const items = [client({ id: 'on', active: true }), client({ id: 'off', active: false })];

  test.each([
    ['all', ['on', 'off']],
    ['active', ['on']],
    ['inactive', ['off']],
  ] as const)('status=%s', (status, expected) => {
    expect(ids(filterClients(items, { ...ALL, status }))).toEqual(expected);
  });
});

describe('filterClients — city', () => {
  const items = [
    client({ id: 'cairo', city: 'Cairo' }),
    client({ id: 'giza', city: 'Giza' }),
    client({ id: 'padded', city: '  Cairo  ' }),
    client({ id: 'none', city: null }),
  ];

  test("'all' keeps every client, including the ones with no city", () => {
    expect(ids(filterClients(items, ALL))).toEqual(['cairo', 'giza', 'padded', 'none']);
  });

  test('a city matches on the TRIMMED value, so a padded cell is not a second city', () => {
    expect(ids(filterClients(items, { ...ALL, city: 'Cairo' }))).toEqual(['cairo', 'padded']);
  });

  test('a client with NO city matches no named city', () => {
    expect(ids(filterClients(items, { ...ALL, city: 'Giza' }))).toEqual(['giza']);
  });
});

describe('filterClients — the search', () => {
  const items = [
    client({ id: 'en', nameEn: 'Nile Interiors', nameAr: null, email: null }),
    client({ id: 'ar', nameEn: null, nameAr: 'النيل للديكور', email: null }),
    client({ id: 'mail', nameEn: 'Delta', nameAr: null, email: 'ops@nile.example' }),
  ];

  test('matches the ENGLISH name, case-insensitively', () => {
    expect(ids(filterClients(items, { ...ALL, query: 'nile interiors' }))).toEqual(['en']);
  });

  test('matches the ARABIC name', () => {
    expect(ids(filterClients(items, { ...ALL, query: 'النيل' }))).toEqual(['ar']);
  });

  test('matches the EMAIL — the spec promises name AND email', () => {
    expect(ids(filterClients(items, { ...ALL, query: 'ops@' }))).toEqual(['mail']);
  });

  test('a null name does not match the word null', () => {
    expect(filterClients(items, { ...ALL, query: 'null' })).toEqual([]);
  });

  test('the three filters compose — status AND city AND query', () => {
    const rows = [
      client({ id: 'hit', active: true, city: 'Cairo', nameEn: 'Nile' }),
      client({ id: 'wrongCity', active: true, city: 'Giza', nameEn: 'Nile' }),
      client({ id: 'inactive', active: false, city: 'Cairo', nameEn: 'Nile' }),
      // nameEn, nameAr AND email must all miss: the search reads all three.
      client({
        id: 'noMatch',
        active: true,
        city: 'Cairo',
        nameEn: 'Delta',
        nameAr: null,
        email: null,
      }),
    ];
    const filter: ClientFilter = { query: 'nile', status: 'active', city: 'Cairo' };
    expect(ids(filterClients(rows, filter))).toEqual(['hit']);
  });
});

describe('cityOptions', () => {
  test('lists each city once, trimmed, sorted for the locale', () => {
    const items = [
      client({ city: 'Giza' }),
      client({ city: '  Cairo  ' }),
      client({ city: 'Cairo' }),
      client({ city: null }),
      client({ city: '   ' }),
    ];
    expect(cityOptions(items, 'en')).toEqual(['Cairo', 'Giza']);
  });

  test('no clients means no options, not a crash', () => {
    expect(cityOptions([], 'ar-EG')).toEqual([]);
  });
});
