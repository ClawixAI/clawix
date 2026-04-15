export interface SessionCommandContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly channelId: string;
  readonly senderId: string;
  readonly agentDefinitionId: string;
  readonly args?: string;
}

export interface SessionCommandResult {
  readonly text: string;
  /** If set, the router forwards this text to the agent instead of replying directly. */
  readonly forwardToAgent?: string;
}

export interface SessionCommand {
  readonly name: string;
  readonly description: string;
  execute(ctx: SessionCommandContext): Promise<SessionCommandResult>;
}
