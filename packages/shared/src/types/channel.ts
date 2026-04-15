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
export interface InboundMessage {
  readonly channelType: ChannelType;
  readonly channelMessageId: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly text: string;
  readonly timestamp: Date;
  readonly rawPayload?: unknown;
}

/** Outbound message to send via a channel adapter. */
export interface OutboundMessage {
  readonly recipientId: string;
  readonly text: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
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

  sendMessage(message: OutboundMessage): Promise<void>;
  sendTyping?(recipientId: string): Promise<void>;
  sendTypingStop?(recipientId: string): Promise<void>;

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
