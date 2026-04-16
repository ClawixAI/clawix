import { z } from 'zod';

// --- Client → Server messages ---

const messageSendSchema = z.object({
  type: z.literal('message.send'),
  payload: z.object({
    content: z.string().min(1).max(10_000),
  }),
});

const pingSchema = z.object({
  type: z.literal('ping'),
  payload: z.object({}).passthrough(),
});

const clientMessageSchema = z.discriminatedUnion('type', [messageSendSchema, pingSchema]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const json: unknown = JSON.parse(raw);
    const result = clientMessageSchema.safeParse(json);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// --- Server → Client messages ---

export type ServerMessage =
  | { readonly type: 'connection.ack'; readonly payload: { readonly userId: string } }
  | {
      readonly type: 'message.create';
      readonly payload: {
        readonly messageId: string;
        readonly sessionId: string;
        readonly content: string;
        readonly timestamp: string;
      };
    }
  | { readonly type: 'typing.start'; readonly payload: Record<string, never> }
  | { readonly type: 'typing.stop'; readonly payload: Record<string, never> }
  | { readonly type: 'pong'; readonly payload: Record<string, never> }
  | {
      readonly type: 'error';
      readonly payload: { readonly code: string; readonly message: string };
    };

export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
