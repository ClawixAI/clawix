import type { ToolDefinition } from '@clawix/shared';

import type { ApprovalScopeKind } from '../approvals/approval.types.js';

/** Result returned by a tool execution. */
export interface ToolResult {
  readonly output: string;

  /**
   * True when the tool failed to produce a normal result and the `output`
   * contains an error description. Used by ToolLoopGuard to detect
   * pathological retry-the-same-broken-call patterns.
   */
  readonly isError: boolean;
}

/** JSON Schema property definition for tool parameter validation. */
export interface ParamSchema {
  readonly type?: string;
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly items?: ParamSchema;
  readonly properties?: Readonly<Record<string, ParamSchema>>;
  readonly required?: readonly string[];
}

/** Per-call execution context passed by the registry. */
export interface ToolExecuteContext {
  /** Signal that fires when the run is cancelled (user stop or timeout). */
  readonly abortSignal?: AbortSignal;
}

/** Interface every tool must implement. */
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: ParamSchema;

  /**
   * When true, the registry passes params to execute() verbatim — no casting,
   * no schema validation, no unknown-key stripping. For tools whose schema is
   * owned by an external system (e.g. MCP servers) that validates its own
   * input. Output post-processing (truncation, error hints) still applies.
   */
  readonly rawParams?: boolean;

  /** When true, ToolRegistry gates execute() behind ToolApprovalService (spec §3). */
  readonly requiresApproval?: boolean;

  /** What an "Always" decision covers. Default 'call' — the conservative floor (spec §2). */
  readonly approvalScope?: ApprovalScopeKind;

  /** Required when approvalScope === 'resource'. Derives the memory key from validated params. */
  readonly resourceKeyFromParams?: (params: Record<string, unknown>) => string;

  /**
   * Optional per-call refinement of `requiresApproval`. When present on a tool
   * with `requiresApproval: true`, the registry evaluates it against the
   * validated params; a `false` return means this specific call is exempt from
   * approval (e.g. a read-only action of a multi-action tool). Absent predicate
   * = every call requires approval. If the predicate throws, the call is
   * treated as requiring approval (fail closed).
   */
  readonly requiresApprovalForParams?: (params: Record<string, unknown>) => boolean;

  /**
   * Optional per-call warnings the registry surfaces to the human reviewer in
   * the approval prompt (Task/`ToolApprovalService.gate` → `deliverPrompt` →
   * the dashboard ApprovalCard).
   *
   * Unlike `requiresApprovalForParams`, this does NOT change whether the call
   * is gated — it only annotates the prompt with caveats the reviewer should
   * see before rubber-stamping. The motivating case: `shell_net` reusing the
   * `clawix-python-net-egress` network can host a freshly-downloaded Python
   * interpreter even though the runner image is python-free, so a `python …`
   * / `pip install …` call escapes the `python_run[_net]` policy surface. The
   * runner image is a nudge, the human is the real boundary, and warnings make
   * that last boundary honest instead of depending on the approver noticing a
   * buried command line.
   *
   * Returns non-empty when the call is suspicious; `[]` (or absent) otherwise.
   * Throw is contained (a thrown hook is logged and produces no warnings — it
   * never inflates the prompt or blocks the call).
   */
  readonly approvalWarningsForParams?: (params: Record<string, unknown>) => readonly string[];

  execute(params: Record<string, unknown>, ctx?: ToolExecuteContext): Promise<ToolResult>;
}

/** Convert a Tool to the ToolDefinition format expected by LLM providers. */
export function toToolDefinition(tool: Tool): ToolDefinition {
  // ParamSchema is a typed JSON Schema subset; ToolDefinition.inputSchema is
  // intentionally opaque (Record<string, unknown>) for provider consumption.
  // The widening through `unknown` makes the deliberate type erasure explicit.
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as unknown as Readonly<Record<string, unknown>>,
  };
}
