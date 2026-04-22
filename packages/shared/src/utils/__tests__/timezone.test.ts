import { describe, expect, it } from 'vitest';

import { isValidIanaTimezone } from '../timezone.js';

describe('isValidIanaTimezone', () => {
  it('accepts UTC', () => {
    expect(isValidIanaTimezone('UTC')).toBe(true);
  });

  it('accepts region/city IANA names', () => {
    expect(isValidIanaTimezone('America/New_York')).toBe(true);
    expect(isValidIanaTimezone('Asia/Tokyo')).toBe(true);
    expect(isValidIanaTimezone('Europe/Berlin')).toBe(true);
  });

  it('rejects unknown names', () => {
    expect(isValidIanaTimezone('Mars/Olympus')).toBe(false);
    expect(isValidIanaTimezone('Not_A_Zone')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidIanaTimezone('')).toBe(false);
  });
});
