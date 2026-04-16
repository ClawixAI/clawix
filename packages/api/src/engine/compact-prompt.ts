/**
 * Prompt builders for LLM-driven memory consolidation.
 *
 * Produces structured prompts that guide the consolidation LLM to generate
 * organized summaries with consistent sections covering intent, technical
 * context, files, errors, decisions, pending tasks, and current state.
 */

/**
 * Build the system prompt for the consolidation LLM call.
 *
 * @param existingSummary - The existing memory summary text (empty string if none)
 */
export function buildConsolidationSystemPrompt(existingSummary: string): string {
  return [
    'You are a memory consolidation assistant. Your job is to summarise old conversation messages into compact working memory.',
    existingSummary ? `Current memory context:\n${existingSummary}` : 'No prior memory context.',
  ].join('\n\n');
}

/**
 * Build the user prompt for the consolidation LLM call.
 *
 * @param formattedChunk - The formatted messages to consolidate
 * @param customInstructions - Optional user-provided instructions for the summary
 */
export function buildConsolidationUserPrompt(
  formattedChunk: string,
  customInstructions?: string,
): string {
  const sections = [
    `Please consolidate the following conversation messages into memory.

Write your response using the save_memory tool with these guidelines:

For \`memory_update\`, organize into these sections (omit empty sections):
1. **Primary Request & Intent** — what the user is trying to accomplish
2. **Key Technical Context** — languages, frameworks, APIs, domain concepts
3. **Files & Code** — file paths, function names, code snippets referenced
4. **Errors & Fixes** — problems encountered and how they were resolved
5. **Decisions Made** — technical choices, trade-offs, rejected alternatives
6. **Pending Tasks** — work acknowledged but not yet completed
7. **Current State** — where the conversation left off

For \`history_entry\`, write a concise 2-3 sentence chronological log entry.`,
  ];

  if (customInstructions) {
    sections.push(`Additional instructions: ${customInstructions}`);
  }

  sections.push(`Messages to consolidate:\n\n${formattedChunk}`);

  return sections.join('\n\n');
}
