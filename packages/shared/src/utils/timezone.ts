/**
 * Returns true if the given string is a valid IANA timezone identifier
 * (including the special case 'UTC'). Uses Intl.DateTimeFormat, which
 * throws RangeError on unknown zones.
 */
export function isValidIanaTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
