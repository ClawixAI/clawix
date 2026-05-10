/**
 * Copy `text` to the clipboard, robust across dev setups.
 *
 * `navigator.clipboard.writeText` only exists in secure contexts (HTTPS or
 * localhost). When the dashboard is accessed over a LAN IP / hostname (the
 * usual case on Linux dev machines), `navigator.clipboard` is `undefined`
 * and a naïve call throws. We feature-detect, then fall back to the
 * legacy hidden-textarea + document.execCommand('copy') approach.
 *
 * Returns true on confirmed success, false on any failure.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Modern path — only available in secure contexts.
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }

  // Legacy fallback. Works on http:// origins where the async API is gated.
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Move it off-screen + minimise side effects on layout / focus.
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.boxShadow = 'none';
  textarea.style.background = 'transparent';
  textarea.setAttribute('readonly', '');
  document.body.appendChild(textarea);
  const previousFocus = document.activeElement as HTMLElement | null;
  textarea.select();
  let ok = false;
  try {
    // execCommand('copy') is deprecated, but it's the only path that works
    // when navigator.clipboard is gated by a non-secure context (HTTP over
    // LAN — common on Linux dev machines). Keeping it as the explicit
    // fallback for those setups.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  previousFocus?.focus?.();
  return ok;
}
