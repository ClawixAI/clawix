import type { ToolDefinition } from '@clawix/shared';

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
