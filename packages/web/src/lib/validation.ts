import { z } from 'zod';

/**
 * Client-side form validation schemas (#106).
 *
 * Forms previously relied solely on the HTML `required` attribute, which is
 * trivially bypassed and silently coerces bad values (e.g. `0` for a token
 * limit). These zod schemas validate before submit and surface inline,
 * field-level error messages. Numeric fields use `z.coerce` so the string
 * values pulled from `FormData` are validated as numbers — `0`/negative/NaN
 * are rejected instead of being swallowed by a `Number(x) || fallback`.
 */

/** First error message per top-level field, keyed by field name. */
export type FieldErrors = Record<string, string>;

/** Flatten a ZodError into one message per top-level field path. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in out)) out[key] = issue.message;
  }
  return out;
}

/**
 * Parse `input` against `schema`. Returns the typed data on success, or a
 * `fieldErrors` map on failure — never throws.
 */
export function parseForm<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { success: true; data: T } | { success: false; fieldErrors: FieldErrors } {
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, fieldErrors: toFieldErrors(result.error) };
}

// ------------------------------------------------------------------ //
//  Reusable field builders                                            //
// ------------------------------------------------------------------ //

const requiredText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

const optionalText = (label: string, max: number) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer`).optional();

/** Empty string or a valid URL. Empty maps to "not provided". */
const optionalUrl = z
  .union([z.literal(''), z.string().trim().url('Must be a valid URL (https://…)')])
  .optional();

/** Coerced integer with a minimum. Rejects blank, NaN, and values below `min`. */
const intMin = (label: string, min: number) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`);

/** Empty string (→ unlimited/null) or a coerced integer ≥ `min`. */
const optionalIntMin = (label: string, min: number) =>
  z.union([z.literal(''), intMin(label, min)]).optional();

// ------------------------------------------------------------------ //
//  Agent                                                              //
// ------------------------------------------------------------------ //

export const agentFormSchema = z.object({
  name: requiredText('Name', 100),
  description: optionalText('Description', 500),
  systemPrompt: requiredText('System prompt', 20000),
  provider: z.string().trim().min(1, 'Select a provider'),
  model: requiredText('Model', 200),
  apiBaseUrl: optionalUrl,
  maxTokensPerRun: intMin('Max tokens per run', 1000),
});

// ------------------------------------------------------------------ //
//  Provider                                                           //
// ------------------------------------------------------------------ //

export const providerCreateSchema = z.object({
  provider: z
    .string()
    .trim()
    .min(1, 'Provider ID is required')
    .max(50, 'Provider ID must be 50 characters or fewer')
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, and hyphens only (no spaces)'),
  displayName: requiredText('Display name', 100),
  apiKey: z.string().trim().min(1, 'API key is required'),
  apiBaseUrl: optionalUrl,
});

export const providerEditSchema = z.object({
  displayName: requiredText('Display name', 100),
  // Blank = keep the existing key.
  apiKey: z.string().trim().optional(),
  apiBaseUrl: optionalUrl,
});

// ------------------------------------------------------------------ //
//  Policy                                                             //
// ------------------------------------------------------------------ //

export const policyFormSchema = z.object({
  name: requiredText('Name', 60),
  description: optionalText('Description', 200),
  maxTokenBudget: optionalIntMin('Token budget', 0),
  maxAgents: intMin('Max agents', 1),
  maxSkills: intMin('Max skills', 1),
  maxGroupsOwned: intMin('Max groups owned', 1),
  maxScheduledTasks: intMin('Max scheduled tasks', 1),
  minCronIntervalSecs: intMin('Min cron interval', 60),
  maxTokensPerCronRun: optionalIntMin('Max tokens per cron run', 0),
});

// ------------------------------------------------------------------ //
//  Channel                                                            //
// ------------------------------------------------------------------ //

export const channelTelegramCreateSchema = z.object({
  name: requiredText('Name', 100),
  bot_token: z.string().trim().min(1, 'Bot token is required'),
  webhook_url: optionalUrl,
});

/** Non-telegram create + all edits: only the channel name is validated here. */
export const channelNameSchema = z.object({
  name: requiredText('Name', 100),
  webhook_url: optionalUrl,
});

export type AgentFormValues = z.infer<typeof agentFormSchema>;
export type PolicyFormValues = z.infer<typeof policyFormSchema>;
