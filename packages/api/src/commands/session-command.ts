export interface SessionCommandContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly channelId: string;
  readonly senderId: string;
  readonly agentDefinitionId: string;
  readonly args?: string;
}

/**
 * Discriminated event tag attached to a session-command result so adapters
 * can emit a structured WS frame in addition to the text reply.
 *
 * Currently only `session.reset` is meaningful — used by the web adapter
 * to drive auto-clear in `useChat` without resorting to a substring match
 * on the reply text (issue #107). Telegram / WhatsApp adapters ignore it.
 */
export type SessionCommandEvent = 'session.reset';

export interface SessionCommandResult {
  readonly text: string;
  /** If set, the router forwards this text to the agent instead of replying directly. */
  readonly forwardToAgent?: string;
  /** Optional structured signal — forwarded as `OutboundMessage.metadata.event`. */
  readonly event?: SessionCommandEvent;
}

export interface SessionCommand {
  readonly name: string;
  readonly description: string;
  execute(ctx: SessionCommandContext): Promise<SessionCommandResult>;
}
