// Sunrise and sunset for a place and a day, computed locally (NOAA's solar position equations), so sun-based
// automations need no internet. Pure: no clock, no storage.

export interface Location {
  latitude: number;
  longitude: number;
}

export type SunEvent = 'sunrise' | 'sunset';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/**
 * The moment of sunrise or sunset on the calendar day of `day` (in the NAS's time zone), or null on days without one
 * (polar day or night). The sun's centre at 0.833° below the horizon, as in almanacs.
 */
export function sunTime(event: SunEvent, day: Date, where: Location): Date | null {
  const noonLocal = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0);
  // Julian day of that day's noon (UTC), and Julian centuries since J2000.0.
  const jd = noonLocal.getTime() / 86_400_000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const meanLong = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    Math.sin(rad(meanAnom)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * meanAnom)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * meanAnom)) * 0.000289;
  const trueLong = meanLong + centre;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const obliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTime =
    4 *
    deg(
      y * Math.sin(2 * rad(meanLong)) -
        2 * ecc * Math.sin(rad(meanAnom)) +
        4 * ecc * y * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLong)) -
        0.5 * y * y * Math.sin(4 * rad(meanLong)) -
        1.25 * ecc * ecc * Math.sin(2 * rad(meanAnom)),
    );
  const cosH = (Math.cos(rad(90.833)) - Math.sin(rad(where.latitude)) * Math.sin(rad(decl))) / (Math.cos(rad(where.latitude)) * Math.cos(rad(decl)));
  if (cosH < -1 || cosH > 1) return null;
  const hourAngle = deg(Math.acos(cosH));
  // Minutes after UTC midnight of that date.
  const solarNoon = 720 - 4 * where.longitude - eqTime;
  const minutes = event === 'sunrise' ? solarNoon - 4 * hourAngle : solarNoon + 4 * hourAngle;
  const utcMidnight = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  return new Date(utcMidnight + Math.round(minutes * 60_000));
}

/** Whether it is dark (between sunset and the next sunrise) at `at`. Polar days count as light, polar nights as dark. */
export function isDark(at: Date, where: Location): boolean {
  const rise = sunTime('sunrise', at, where);
  const set = sunTime('sunset', at, where);
  if (!rise || !set) {
    // No sunrise or sunset today: light in summer half of the hemisphere, dark otherwise.
    const summer = at.getMonth() >= 3 && at.getMonth() <= 8;
    return where.latitude >= 0 ? !summer : summer;
  }
  return at < rise || at >= set;
}

/** Validates a location: latitude −90…90, longitude −180…180. */
export function validLocation(v: unknown): Location | null {
  if (!v || typeof v !== 'object') return null;
  const { latitude, longitude } = v as Record<string, unknown>;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude: Math.round(latitude * 1000) / 1000, longitude: Math.round(longitude * 1000) / 1000 };
}

/**
 * A random offset in minutes, −spread…+spread, that is the same all day for one rule and one event: deterministic,
 * so a restart doesn't make a rule fire twice or not at all.
 */
export function dailyOffset(seed: string, day: Date, spread: number): number {
  if (spread <= 0) return 0;
  const key = `${seed}|${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % (2 * spread + 1)) - spread;
}
