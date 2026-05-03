import type { ChannelType } from '../types/channel.js';

/**
 * Tool-progress emission mode for a channel.
 *
 * - `off`     — no tool bubbles emitted; only model prose flows through.
 * - `new`     — emit only when the tool name changes between consecutive calls
 *               (suppresses parallel/repeat fires of the same tool).
 * - `all`     — emit every tool call with a short argument preview (40-char cap).
 * - `verbose` — emit every tool call with full JSON-encoded arguments.
 */
export type ToolProgressMode = 'off' | 'new' | 'all' | 'verbose';

const VALID_MODES: readonly ToolProgressMode[] = ['off', 'new', 'all', 'verbose'];

/**
 * Per-platform default mode. Mirrors Hermes's `display_config.py` tier
 * mapping: telegram and web are chatty by default, whatsapp shows tool
 * changes only, slack stays quiet (Bolt posts cannot be edited like CLI).
 */
const PLATFORM_DEFAULTS: Record<ChannelType, ToolProgressMode> = {
  telegram: 'all',
  whatsapp: 'new',
  slack: 'off',
  web: 'all',
};

/**
 * Type guard for `ToolProgressMode`. Strict — only accepts the literal
 * lowercase strings, no coercion.
 */
export function isToolProgressMode(value: unknown): value is ToolProgressMode {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value);
}

/**
 * Resolve the effective tool-progress mode for a channel.
 *
 * @param channelType - The platform type of the channel.
 * @param override    - The channel's `toolProgressMode` column value. Null /
 *                      undefined / empty / invalid → platform default.
 */
export function resolveToolProgressMode(
  channelType: ChannelType,
  override: string | null | undefined,
): ToolProgressMode {
  if (isToolProgressMode(override)) {
    return override;
  }
  return PLATFORM_DEFAULTS[channelType];
}
