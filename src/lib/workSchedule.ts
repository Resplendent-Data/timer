export const DEFAULT_WORK_DAYS: number[] = [0, 1, 2, 3, 4];

/**
 * Parse a local HH:MM time string into minutes since midnight.
 */
export function parseTimeToMinutes(
  time: string | null | undefined,
  fallback: number
): number {
  if (!time) return fallback;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return fallback;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

/**
 * Normalize workday indexes (Mon=0 ... Sun=6).
 */
export function normalizeWorkdays(days: number[] | null | undefined): number[] {
  if (!Array.isArray(days)) return [...DEFAULT_WORK_DAYS];
  const normalized = Array.from(
    new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))
  ).sort((a, b) => a - b);
  return normalized.length > 0 ? normalized : [...DEFAULT_WORK_DAYS];
}

/**
 * Whether the given local timestamp is within the configured work schedule.
 */
export function isWithinWorkSchedule(
  date: Date,
  workdayStart: string | null | undefined,
  workdayEnd: string | null | undefined,
  workdays: number[] | null | undefined
): boolean {
  const normalizedWorkdays = normalizeWorkdays(workdays);
  const currentDay = (date.getDay() + 6) % 7; // JS: Sun=0, Mon=1 -> Mon=0, Sun=6
  if (!normalizedWorkdays.includes(currentDay)) {
    return false;
  }

  const workStartMinutes = parseTimeToMinutes(workdayStart, 8 * 60);
  const workEndMinutes = parseTimeToMinutes(workdayEnd, 17 * 60);
  const currentMinutes = date.getHours() * 60 + date.getMinutes();

  if (workStartMinutes === workEndMinutes) {
    return true;
  }

  if (workStartMinutes < workEndMinutes) {
    return (
      currentMinutes >= workStartMinutes && currentMinutes < workEndMinutes
    );
  }

  return currentMinutes >= workStartMinutes || currentMinutes < workEndMinutes;
}
