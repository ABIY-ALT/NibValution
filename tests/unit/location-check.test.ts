import { describe, expect, it } from 'vitest';
import {
  assessCheckIn,
  assessPhoto,
  distanceMeters,
  formatDistance,
  summarizeVisits,
} from '@/server/domain/site-visit/location-check';
import { siteVisitSchema } from '@/lib/validation/valuation';

const PROPERTY = { latitude: 9.01, longitude: 38.76 };
const RULES = { radiusMeters: 200, maxAccuracyMeters: 100 };

describe('site check-in', () => {
  it('measures great-circle distance in metres', () => {
    expect(distanceMeters(PROPERTY, PROPERTY)).toBe(0);
    // 0.0005 degrees of latitude is about 55.6 m anywhere on Earth.
    expect(distanceMeters(PROPERTY, { latitude: 9.0105, longitude: 38.76 })).toBeCloseTo(55.6, 0);
    // Addis Ababa to Debre Birhan, roughly 120 km as the crow flies.
    const debreBirhan = { latitude: 9.6797, longitude: 39.5333 };
    expect(distanceMeters(PROPERTY, debreBirhan) / 1000).toBeGreaterThan(110);
    expect(distanceMeters(PROPERTY, debreBirhan) / 1000).toBeLessThan(130);
  });

  it('verifies a precise check-in within the radius', () => {
    const result = assessCheckIn({
      checkIn: { latitude: 9.0105, longitude: 38.76, accuracyMeters: 15 },
      property: PROPERTY,
      ...RULES,
    });
    expect(result.check).toBe('VERIFIED');
    expect(result.setsPropertyLocation).toBe(false);
  });

  it('flags a precise check-in beyond the radius, with its distance', () => {
    const result = assessCheckIn({
      checkIn: { latitude: 9.05, longitude: 38.76, accuracyMeters: 10 },
      property: PROPERTY,
      ...RULES,
    });
    expect(result.check).toBe('OUTSIDE_RADIUS');
    expect(result.distanceMeters).toBeGreaterThan(4000);
  });

  it('refuses to judge a vague fix, even one that lands on the property', () => {
    const result = assessCheckIn({
      checkIn: { ...PROPERTY, accuracyMeters: 850 },
      property: PROPERTY,
      ...RULES,
    });
    expect(result.check).toBe('LOW_ACCURACY');
    expect(result.distanceMeters).toBe(0);
  });

  it('lets a precise check-in locate a property with no coordinates, but not a vague one', () => {
    expect(
      assessCheckIn({ checkIn: { ...PROPERTY, accuracyMeters: 12 }, property: null, ...RULES }),
    ).toEqual({ check: 'LOCATION_SET', distanceMeters: null, setsPropertyLocation: true });
    expect(
      assessCheckIn({ checkIn: { ...PROPERTY, accuracyMeters: 400 }, property: null, ...RULES })
        .setsPropertyLocation,
    ).toBe(false);
  });

  it('records a visit without a position as unverified', () => {
    expect(assessCheckIn({ checkIn: null, property: PROPERTY, ...RULES }).check).toBe(
      'NO_LOCATION',
    );
  });

  it('judges a photo like a check-in, except that it never locates the property', () => {
    expect(
      assessPhoto({ position: { ...PROPERTY, accuracyMeters: 10 }, property: PROPERTY, ...RULES }),
    ).toEqual({ check: 'VERIFIED', distanceMeters: 0 });
    expect(
      assessPhoto({ position: { ...PROPERTY, accuracyMeters: 10 }, property: null, ...RULES }),
    ).toEqual({ check: null, distanceMeters: null });
    expect(assessPhoto({ position: null, property: PROPERTY, ...RULES }).check).toBe('NO_LOCATION');
  });

  it('sums up a case’s visits in one word', () => {
    expect(summarizeVisits([])).toBe('NONE');
    expect(summarizeVisits(['NO_LOCATION', 'OUTSIDE_RADIUS'])).toBe('FLAGGED');
    expect(summarizeVisits(['OUTSIDE_RADIUS', 'VERIFIED'])).toBe('VERIFIED');
    expect(summarizeVisits(['LOCATION_SET'])).toBe('VERIFIED');
  });

  it('writes distances in metres, then kilometres', () => {
    expect(formatDistance(55.6)).toBe('56 m');
    expect(formatDistance('999.4')).toBe('999 m');
    expect(formatDistance(4321)).toBe('4.3 km');
  });

  it('accepts a whole reading or none, never part of one', () => {
    // The form always posts findings and remarks, empty or not.
    const base = {
      caseId: '00000000-0000-4000-8000-000000000000',
      accessGained: 'yes',
      findings: '',
      remarks: '',
    };
    expect(siteVisitSchema.safeParse(base).success).toBe(true);
    expect(
      siteVisitSchema.safeParse({ ...base, latitude: '', longitude: '', accuracyMeters: '' })
        .success,
    ).toBe(true);
    expect(
      siteVisitSchema.safeParse({
        ...base,
        latitude: '9.01',
        longitude: '38.76',
        accuracyMeters: '12.5',
      }).data,
    ).toMatchObject({ latitude: 9.01, longitude: 38.76, accuracyMeters: 12.5 });
    expect(siteVisitSchema.safeParse({ ...base, latitude: '9.01' }).success).toBe(false);
    expect(
      siteVisitSchema.safeParse({ ...base, latitude: '95', longitude: '38', accuracyMeters: '5' })
        .success,
    ).toBe(false);
  });
});
