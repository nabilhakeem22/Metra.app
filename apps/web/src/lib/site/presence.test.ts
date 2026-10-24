import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_RADIUS_M, distanceMeters, sitePresence, type GeoPoint, type LocationReading } from './presence';

const PIN = { lat: 30.0444, lng: 31.2357, radiusM: 150 };
const EARTH_RADIUS_M = 6_371_008.8;

/** The point `meters` due north of `from` on the plan's sphere: an exact distance to test against. */
function northOf(from: GeoPoint, meters: number): GeoPoint {
  return { lat: from.lat + (meters / EARTH_RADIUS_M) * (180 / Math.PI), lng: from.lng };
}

function fixAt(meters: number, accuracyM: number): LocationReading {
  return { status: 'fixed', ...northOf(PIN, meters), accuracyM, fixedAt: '2026-10-23T07:00:00Z' };
}

describe('distanceMeters', () => {
  it('is 0 for one point', () => {
    expect(distanceMeters(PIN, PIN)).toBe(0);
  });

  it('measures one degree of latitude as 2πR/360 on the mean-radius sphere, rounded', () => {
    expect(distanceMeters({ lat: 30, lng: 31 }, { lat: 31, lng: 31 })).toBe(111195);
  });

  it('measures along a parallel with the cosine of the latitude', () => {
    // One degree of longitude at 60° is half a degree of the equator.
    expect(distanceMeters({ lat: 60, lng: 0 }, { lat: 60, lng: 1 })).toBe(55597);
  });

  it('is symmetric and whole', () => {
    const a = { lat: 30.0444, lng: 31.2357 };
    const b = { lat: 30.0561, lng: 31.2394 };
    expect(distanceMeters(a, b)).toBe(distanceMeters(b, a));
    expect(Number.isInteger(distanceMeters(a, b))).toBe(true);
  });

  it('stays finite for antipodal points', () => {
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBe(Math.round(Math.PI * EARTH_RADIUS_M));
  });
});

describe('sitePresence: the plan examples (AC1), pin 30.0444, 31.2357, radius 150', () => {
  it.each([
    [120, 20, 'on_site'],
    [400, 50, 'off_site'],
    // Within 150 + 80.
    [200, 80, 'on_site'],
    // Over 150 + 100 (the capped benefit), within 150 + 200.
    [300, 200, 'uncertain'],
  ] as const)('a fix %i m away with accuracy %i m is %s', (meters, accuracyM, presence) => {
    expect(sitePresence(PIN, fixAt(meters, accuracyM))).toEqual({ presence, distanceM: meters });
  });

  it('any fix with accuracy 600 is uncertain, and its distance is still measured', () => {
    for (const meters of [0, 120, 5000]) {
      expect(sitePresence(PIN, fixAt(meters, 600))).toEqual({ presence: 'uncertain', distanceM: meters });
    }
  });

  it('status denied is no_location, without a distance', () => {
    expect(sitePresence(PIN, { status: 'denied' })).toEqual({ presence: 'no_location', distanceM: null });
  });

  it('a null pin is no_site_pin, even with a good fix', () => {
    expect(sitePresence(null, fixAt(0, 5))).toEqual({ presence: 'no_site_pin', distanceM: null });
    expect(sitePresence(null, { status: 'denied' })).toEqual({ presence: 'no_site_pin', distanceM: null });
  });
});

describe('sitePresence: the edges of each rule', () => {
  it('every status but fixed is no_location', () => {
    for (const status of ['denied', 'unavailable', 'timeout', 'unsupported', 'declined'] as const) {
      expect(sitePresence(PIN, { status }).presence).toBe('no_location');
    }
  });

  it('accuracy exactly 500 is still usable; 501 is not', () => {
    expect(sitePresence(PIN, fixAt(100, 500)).presence).toBe('on_site');
    expect(sitePresence(PIN, fixAt(100, 501)).presence).toBe('uncertain');
  });

  it('on the boundary of radius + capped accuracy is on site; one metre past it is not', () => {
    expect(sitePresence(PIN, fixAt(250, 100)).presence).toBe('on_site');
    expect(sitePresence(PIN, fixAt(251, 100)).presence).toBe('off_site');
    expect(sitePresence(PIN, fixAt(250, 300)).presence).toBe('on_site');
    expect(sitePresence(PIN, fixAt(251, 300)).presence).toBe('uncertain');
  });

  it('exactly radius + accuracy is uncertain, never off site', () => {
    expect(sitePresence(PIN, fixAt(450, 300)).presence).toBe('uncertain');
    expect(sitePresence(PIN, fixAt(451, 300)).presence).toBe('off_site');
  });

  it('a perfect fix decides at the radius itself', () => {
    expect(sitePresence(PIN, fixAt(150, 0)).presence).toBe('on_site');
    expect(sitePresence(PIN, fixAt(151, 0)).presence).toBe('off_site');
  });

  it('the default radius is 150 m', () => {
    expect(DEFAULT_SITE_RADIUS_M).toBe(150);
  });

  it('refuses a fixed reading without its numbers rather than guessing a verdict', () => {
    expect(() => sitePresence(PIN, { status: 'fixed', lat: 30, lng: 31 })).toThrow(RangeError);
    expect(() => sitePresence(PIN, { status: 'fixed', lat: Number.NaN, lng: 31, accuracyM: 10 })).toThrow(RangeError);
    expect(() => sitePresence(PIN, { status: 'fixed', lat: 30, lng: Infinity, accuracyM: 10 })).toThrow(RangeError);
  });
});
