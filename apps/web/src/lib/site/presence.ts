// Was the engineer on site when he checked in? (Stage 3 site app, plan C2.)
// PURE and CLIENT-SAFE: the check-in core decides the verdict that is stored,
// and the phone may show the same verdict before the answer comes back.
//
// One foreground fix is compared against the project's site pin (a point and a
// radius). A fix carries its own accuracy circle, so the rule gives the benefit
// of the doubt up to 100 m of accuracy, never calls a fix off site while its
// circle still reaches the site, and calls a fix worse than 500 m uncertain
// whatever it says.

/** Every verdict, runtime-enumerable so the catalogue test can prove each has its label. */
export const SITE_PRESENCES = ['on_site', 'off_site', 'uncertain', 'no_location', 'no_site_pin'] as const;

export type SitePresence = (typeof SITE_PRESENCES)[number];

export type LocationStatus = 'fixed' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'declined';

/** One location attempt as the phone reports it; the numbers are set only when `status` is `fixed`. */
export interface LocationReading {
  status: LocationStatus;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  /** ISO instant of the fix, device clock. */
  fixedAt?: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** The site pin stored on a project. */
export interface SitePin extends GeoPoint {
  radiusM: number;
}

export interface PresenceVerdict {
  presence: SitePresence;
  /** Metres from the pin, rounded; null when there was no fix or no pin to measure from. */
  distanceM: number | null;
}

/** The radius a new pin takes unless the person setting it chooses another. */
export const DEFAULT_SITE_RADIUS_M = 150;

/** The mean Earth radius (IUGG), in metres. */
const EARTH_RADIUS_M = 6_371_008.8;
/** Accuracy counted in the engineer's favour, at most. */
const ACCURACY_BENEFIT_CAP_M = 100;
/** A fix less accurate than this says nothing about where the phone is. */
const UNUSABLE_ACCURACY_M = 500;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** A finite latitude within ±90 and longitude within ±180. */
function isGeoPoint(lat: number | undefined, lng: number | undefined): boolean {
  return Number.isFinite(lat) && Math.abs(lat!) <= 90 && Number.isFinite(lng) && Math.abs(lng!) <= 180;
}

/** A finite, non-negative number of metres (a radius, an accuracy). */
function isMetres(value: number | undefined): boolean {
  return Number.isFinite(value) && value! >= 0;
}

function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const chord =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(chord))));
}

/** Great-circle (haversine) distance between two points, in whole metres. A point off the globe is a caller bug. */
export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  if (!isGeoPoint(from.lat, from.lng) || !isGeoPoint(to.lat, to.lng)) {
    throw new RangeError('distanceMeters needs a finite lat within ±90 and lng within ±180 on both points.');
  }
  return haversineMeters(from, to);
}

/** The pin, checked. A pin off the globe or with a negative or non-finite radius is a caller bug. */
function pinOf(site: SitePin): SitePin {
  if (!isGeoPoint(site.lat, site.lng) || !isMetres(site.radiusM)) {
    throw new RangeError('A site pin needs a finite lat within ±90, lng within ±180 and a radius of 0 m or more.');
  }
  return site;
}

/** The point and accuracy of a fixed reading. A fixed reading without them, or off the globe, is a caller bug. */
function fixOf(reading: LocationReading): GeoPoint & { accuracyM: number } {
  const { lat, lng, accuracyM } = reading;
  if (!isGeoPoint(lat, lng) || !isMetres(accuracyM)) {
    throw new RangeError('A fixed location reading needs a finite lat within ±90, lng within ±180 and an accuracyM of 0 or more.');
  }
  return { lat: lat!, lng: lng!, accuracyM: accuracyM! };
}

/**
 * The presence verdict for one reading against the project's pin. In order:
 * no pin, no fix, an unusable fix (still measured), inside the radius plus the
 * capped accuracy, beyond the radius plus the whole accuracy, else uncertain.
 * A pin or a fix that cannot be real (pinOf, fixOf) throws RangeError.
 */
export function sitePresence(site: SitePin | null, reading: LocationReading): PresenceVerdict {
  if (site === null) return { presence: 'no_site_pin', distanceM: null };
  const pin = pinOf(site);
  if (reading.status !== 'fixed') return { presence: 'no_location', distanceM: null };
  const fix = fixOf(reading);
  const distanceM = haversineMeters(pin, fix);
  if (fix.accuracyM > UNUSABLE_ACCURACY_M) return { presence: 'uncertain', distanceM };
  if (distanceM <= pin.radiusM + Math.min(fix.accuracyM, ACCURACY_BENEFIT_CAP_M)) {
    return { presence: 'on_site', distanceM };
  }
  if (distanceM > pin.radiusM + fix.accuracyM) return { presence: 'off_site', distanceM };
  return { presence: 'uncertain', distanceM };
}
