import type { ToolProgressMode } from './tool-progress.js';

/** Mutable per-run state used by `new` mode to dedupe consecutive same-name calls. */
export interface BubbleState {
  lastToolName: string | null;
}

export interface ToolStartedEvent {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

const PREVIEW_CAP = 40;
const ELLIPSIS = '…';

/**
 * Per-tool emoji map. Keys are tool names registered in the engine's
 * `ToolRegistry`. Unknown tools fall back to `⚙️`.
 *
 * Order/coverage mirrors the built-in tools registered in
 * `engine/tools/index.ts`. Add an entry here when introducing a new
 * built-in tool that should have a recognizable bubble.
 */
const TOOL_EMOJI: Readonly<Record<string, string>> = {
  web_search: '🔍',
  web_fetch: '🌐',
  shell_exec: '💻',
  read_file: '📖',
  write_file: '📝',
  list_dir: '📂',
  remember: '🧠',
  recall: '🧠',
  spawn: '🤖',
  schedule_task: '⏰',
};

const DEFAULT_EMOJI = '⚙️';

/**
 * Format a `tool_started` event into a single-line bubble string for the
 * channel, or return null when the mode suppresses this call.
 */
export function formatToolBubble(
  event: ToolStartedEvent,
  mode: ToolProgressMode,
  state: BubbleState,
): string | null {
  if (mode === 'off') return null;
  if (mode === 'new' && state.lastToolName === event.name) return null;
  state.lastToolName = event.name;

  const emoji = TOOL_EMOJI[event.name] ?? DEFAULT_EMOJI;

  if (mode === 'verbose') {
    let argsStr: string;
    try {
      argsStr = JSON.stringify(event.args);
    } catch {
      // Defensive: a tool could in principle pass a circular structure.
      // Failing the bubble must not crash the reasoning loop.
      argsStr = '[unserializable]';
    }
    return `${emoji} ${event.name}(${argsStr})`;
  }

  // 'all' / 'new': short preview, cap at 40 chars.
  const preview = pickPreview(event.args, PREVIEW_CAP);
  return preview ? `${emoji} ${event.name}: "${preview}"` : `${emoji} ${event.name}${ELLIPSIS}`;
}

/**
 * Pick a preview from the first string-valued arg in `Object.keys` order
 * (deterministic). Truncate to `cap` chars total (including the ellipsis
 * suffix). Returns null if no string-valued arg exists.
 */
function pickPreview(args: Readonly<Record<string, unknown>>, cap: number): string | null {
  for (const key of Object.keys(args)) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) {
      if (value.length <= cap) return value;
      return value.slice(0, cap - 1) + ELLIPSIS;
    }
  }
  return null;
}
