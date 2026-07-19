export type ApprovalScopeKind = 'run' | 'resource' | 'call';

export type ApprovalChoice =
  | 'allow_once'
  | 'allow_session'
  | 'allow_always'
  | 'deny_once'
  | 'deny_session'
  | 'deny_always';

export type MemoryDecision = 'allow' | 'deny';

/** `${toolName}:${resourceKey}` — resourceKey '' for run/call scopes. */
export function memoryKey(toolName: string, resourceKey: string): string {
  return `${toolName}:${resourceKey}`;
}

/** Scopes offerable for a prompt, computed server-side (spec §6/§7). */
export function offeredScopes(
  scopeKind: ApprovalScopeKind,
  extractorFailed: boolean,
): readonly ApprovalChoice[] {
  if (extractorFailed) return ['allow_once', 'deny_once'];
  if (scopeKind === 'call') return ['allow_once', 'allow_session', 'deny_once', 'deny_session'];
  return [
    'allow_once',
    'allow_session',
    'allow_always',
    'deny_once',
    'deny_session',
    'deny_always',
  ];
}

/** Server-side symmetric downgrade of an out-of-scope choice (spec §6). */
export function downgradeChoice(
  choice: ApprovalChoice,
  offered: readonly ApprovalChoice[],
): { choice: ApprovalChoice; downgraded: boolean } {
  if (offered.includes(choice)) return { choice, downgraded: false };
  const ladder: Record<ApprovalChoice, readonly ApprovalChoice[]> = {
    allow_always: ['allow_session', 'allow_once'],
    allow_session: ['allow_once'],
    allow_once: [],
    deny_always: ['deny_session', 'deny_once'],
    deny_session: ['deny_once'],
    deny_once: [],
  };
  for (const next of ladder[choice]) {
    if (offered.includes(next)) return { choice: next, downgraded: true };
  }
  // Fall back to the weakest same-direction choice; offered always contains both *_once.
  const fallback: ApprovalChoice = choice.startsWith('allow') ? 'allow_once' : 'deny_once';
  return { choice: fallback, downgraded: choice !== fallback };
}

export interface LookupHit {
  readonly decision: MemoryDecision;
  readonly store: 'session' | 'persistent';
  readonly key: string;
  readonly scope: 'session' | 'always';
}

export type LookupResult =
  | { readonly kind: 'allow'; readonly hit: LookupHit }
  | { readonly kind: 'deny'; readonly hit: LookupHit }
  | { readonly kind: 'prompt'; readonly reason: 'no_memory' | 'extractor_error' };
