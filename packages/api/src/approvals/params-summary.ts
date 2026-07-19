const SECRET_KEY_RE = /key|token|secret|password|credential|authorization/i;
const SECRET_VALUE_RE =
  /(Bearer\s+[\w.~+/-]+=*|sk-[\w-]{8,}|ghp_[\w]{20,}|AKIA[0-9A-Z]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)/g;
const MAX_VALUE_CHARS = 200;

/**
 * Build the display-only summary of tool params (spec §7). Best-effort regex
 * masking, NOT leak-proof — the reviewing user is the trust boundary. The
 * tool always executes the raw args; this copy goes to chat/Telegram/bell/DB.
 */
export function redactParamsSummary(
  params: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    let text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
    if (SECRET_KEY_RE.test(key)) {
      text = '***';
    } else {
      text = text.replace(SECRET_VALUE_RE, '***');
    }
    if (text.length > MAX_VALUE_CHARS) text = `${text.slice(0, MAX_VALUE_CHARS)}…`;
    result[key] = text;
  }
  return result;
}
