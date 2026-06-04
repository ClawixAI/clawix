export type ChannelType = 'whatsapp' | 'slack' | 'web' | 'telegram';

export interface Channel {
  readonly id: string;
  readonly type: ChannelType;
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ------------------------------------------------------------------ //
//  Channel adapter types (Phase 4A)                                   //
// ------------------------------------------------------------------ //

/** Inbound message received from a channel adapter. */
export interface ReplyContext {
  from?: { id: number; date: number; isBot: boolean };
  text: string;
}
export interface InboundMessage {
  readonly channelType: ChannelType;
  readonly channelMessageId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly text: string;
  readonly timestamp: Date;
  readonly replyCtx?: ReplyContext;
  readonly rawPayload?: unknown;
}

/**
 * Recognised keys on an outbound message's `metadata`. Adapters read the keys
 * they understand and ignore the rest, so the contract is additive — new keys
 * never break an adapter that doesn't know about them. The index signature
 * keeps it forward-compatible with ad-hoc keys.
 */
export interface OutboundMessageMetadata {
  /** Stable id for the outbound message (web echo / de-dupe). */
  readonly messageId?: string;
  /** Session this message belongs to (web frames). */
  readonly sessionId?: string;
  /** Structured channel event (e.g. `session.reset`) for adapters that render it. */
  readonly event?: string;
  /**
   * Inbound platform message id this outbound should thread/reply to. The
   * Telegram adapter maps it to `reply_parameters.message_id`, gated by the
   * channel's `reply_to_mode`. Adapters without native threading ignore it.
   */
  readonly replyToMessageId?: string;
  readonly [key: string]: unknown;
}

/** Outbound message to send via a channel adapter. */
export interface OutboundMessage {
  readonly recipientId: string;
  readonly text: string;
  readonly metadata?: OutboundMessageMetadata;
}

/** Message handler callback for inbound messages. */
export type MessageHandler = (message: InboundMessage) => Promise<void>;

/**
 * Channel adapter interface — runtime adapter for messaging platforms.
 * Named ChannelAdapter to avoid collision with the Channel DB model type above.
 */
export interface ChannelAdapter {
  readonly id: string;
  readonly type: ChannelType;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /**
   * Send a message to the recipient. Returns the platform message id of the
   * sent message (the last chunk's id when the text is split), or `undefined`
   * when the adapter has no stable id to report. Callers that want to later
   * edit the message in place (e.g. tool-progress status) keep this id and
   * pass it to {@link editMessage}.
   */
  sendMessage(message: OutboundMessage): Promise<string | undefined>;

  /**
   * Edit a previously sent message in place. Optional — only adapters whose
   * platform supports editing implement it (e.g. Telegram `editMessageText`).
   * Callers must fall back to {@link sendMessage} when this is absent.
   */
  editMessage?(recipientId: string, messageId: string, text: string): Promise<void>;

  sendTyping?(recipientId: string): Promise<void>;
  sendTypingStop?(recipientId: string): Promise<void>;

  /**
   * Send an out-of-band error to the recipient.
   *
   * Channels that support a structured error path (e.g. WebSocket) should send
   * this through that path so the client can render it as an error rather than
   * an assistant message. Channels without a structured error path should fall
   * back to sending the message text.
   */
  sendError?(recipientId: string, code: string, message: string): Promise<void>;

  onMessage(handler: MessageHandler): void;
}

/** Configuration passed to a channel adapter factory. */
export interface ChannelAdapterConfig {
  readonly id: string;
  readonly type: ChannelType;
  readonly name: string;
  readonly config: Readonly<Record<string, unknown>>;
}

/** Factory function that creates a ChannelAdapter from config. */
export type ChannelAdapterFactory = (config: ChannelAdapterConfig) => ChannelAdapter;
