/**
 * Helpers for safely reading values out of a `FormData`.
 *
 * `FormData.get` returns `string | File | null`; the codebase frequently cast
 * the result with `as string`, which is a runtime lie for missing fields or
 * file inputs (#116). These helpers narrow honestly instead.
 */

/**
 * Read a text field from `FormData` as a string.
 *
 * Returns `fallback` (default `''`) when the field is absent or is a `File`
 * entry, so callers never receive `null`/`File` where a string is expected.
 */
export function formString(form: FormData, key: string, fallback = ''): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : fallback;
}
