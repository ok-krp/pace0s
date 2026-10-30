/**
 * Validates a calendar date without accepting JavaScript's date rollover
 * (for example, 2026-02-31 silently becoming a date in March).
 */
export function isValidIsoDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysPerMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysPerMonth[month - 1];
}

/**
 * Accepts ISO-8601 timestamps only when the calendar date, clock time, and
 * explicit timezone are valid. This avoids local-time ambiguity in filters.
 */
export function isValidIsoTimestamp(value: string): boolean {
  const match = /^(\\d{4}-\\d{2}-\\d{2})T(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d{1,9})?)?(?:Z|[+-](?:[01]\\d|2[0-3]):?[0-5]\\d)$/.exec(value);
  if (match === null || !isValidIsoDateOnly(match[1])) return false;
  // Date.parse implementations differ on ISO offsets without a colon
  // (±HHMM). Normalize that valid ISO form to ±HH:MM before parsing.
  const normalized = value.endsWith("Z")
    ? value
    : value.replace(/([+-]\\d{2})(\\d{2})$/, "$1:$2");
  return !Number.isNaN(Date.parse(normalized));
}

/** ISO date-only strings sort lexically, so a range can be checked safely. */
export function isOrderedIsoDateRange(from?: string, to?: string): boolean {
  return !from || !to || from <= to;
}
