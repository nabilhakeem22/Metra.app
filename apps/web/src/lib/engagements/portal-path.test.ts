import { describe, expect, it } from 'vitest';
import { tokenPathSegment } from './portal-path';

describe('tokenPathSegment', () => {
  it.each([
    ['qusfkCynyStBRzXriTAMd4j_QZlTXpS-RMjY_fv00T4', 'qusfkCynyStBRzXriTAMd4j_QZlTXpS-RMjY_fv00T4'],
    ['dead%20beef', 'dead%20beef'],
    ['dead beef', 'dead%20beef'],
    ['a%2Fb', 'a%2Fb'],
    ['a/b?c', 'a%2Fb%3Fc'],
    ['%D8%A7%D8%A8', '%D8%A7%D8%A8'],
    ['100%', '100%25'],
  ])('%s becomes one segment, encoded once: %s', (token, segment) => {
    expect(tokenPathSegment(token)).toBe(segment);
  });
});
