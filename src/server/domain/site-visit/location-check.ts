import type { SiteVisitCheck } from '@/server/domain/shared/enums';

/**
 * Judging a site check-in against the property's recorded location.
 *
 * A visit is evidence that the valuator stood at the property. The phone's GPS
 * position is compared with the property's coordinates, and the result is
 * recorded with the visit for the checker and approvers to see:
 *
 *  - VERIFIED        within the configured radius, with a usable GPS fix;
 *  - OUTSIDE_RADIUS  a usable fix, but further from the property than allowed;
 *  - LOW_ACCURACY    the phone reported a fix too vague to judge (indoors,
 *                    weak signal, or a laptop locating itself by Wi-Fi);
 *  - LOCATION_SET    the property had no coordinates, so this check-in becomes
 *                    its location - the checker confirms it against the
 *                    address on the map;
 *  - NO_LOCATION     no position was captured at all.
 *
 * Nothing here blocks a visit from being recorded. GPS is unreliable in places
 * and a property's coordinates can be wrong, so a doubtful check-in is flagged
 * for a person to judge rather than refused.
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface CheckIn extends GeoPoint {
  accuracyMeters: number;
}

export interface CheckInAssessment {
  check: SiteVisitCheck;
  /** Metres from the property, when both positions are known. */
  distanceMeters: number | null;
  /** True when this check-in should become the property's location. */
  setsPropertyLocation: boolean;
}

/** The checks that count as evidence the valuator was at the property. */
export const ON_SITE_CHECKS: ReadonlySet<SiteVisitCheck> = new Set(['VERIFIED', 'LOCATION_SET']);

/**
 * A case's visits in one word, for lists: VERIFIED once any visit proves
 * presence, FLAGGED when visits exist but none does, NONE when there are none.
 */
export type VisitSummary = 'VERIFIED' | 'FLAGGED' | 'NONE';

export function summarizeVisits(checks: readonly SiteVisitCheck[]): VisitSummary {
  if (checks.some((check) => ON_SITE_CHECKS.has(check))) return 'VERIFIED';
  return checks.length > 0 ? 'FLAGGED' : 'NONE';
}

const EARTH_RADIUS_METERS = 6_371_008.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle (haversine) distance in metres. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 85 m, or 4.3 km. */
export function formatDistance(meters: number | string): string {
  const value = Number(meters);
  return value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1)} km`;
}

/**
 * A site photo is judged like a check-in, except that it never locates the
 * property: with no coordinates to compare against, it keeps its position and
 * carries no verdict.
 */
export function assessPhoto(input: {
  position: CheckIn | null;
  property: GeoPoint | null;
  radiusMeters: number;
  maxAccuracyMeters: number;
}): { check: SiteVisitCheck | null; distanceMeters: number | null } {
  const result = assessCheckIn({ ...input, checkIn: input.position });
  return result.check === 'LOCATION_SET'
    ? { check: null, distanceMeters: null }
    : { check: result.check, distanceMeters: result.distanceMeters };
}

export function assessCheckIn(input: {
  checkIn: CheckIn | null;
  property: GeoPoint | null;
  radiusMeters: number;
  maxAccuracyMeters: number;
}): CheckInAssessment {
  const { checkIn, property } = input;
  if (!checkIn) return { check: 'NO_LOCATION', distanceMeters: null, setsPropertyLocation: false };

  const distance = property ? distanceMeters(checkIn, property) : null;

  // A vague fix proves nothing either way, and must not become the property's
  // location for every later visit to be judged against.
  if (checkIn.accuracyMeters > input.maxAccuracyMeters) {
    return { check: 'LOW_ACCURACY', distanceMeters: distance, setsPropertyLocation: false };
  }
  if (distance === null) {
    return { check: 'LOCATION_SET', distanceMeters: null, setsPropertyLocation: true };
  }
  return {
    check: distance <= input.radiusMeters ? 'VERIFIED' : 'OUTSIDE_RADIUS',
    distanceMeters: distance,
    setsPropertyLocation: false,
  };
}
