import pino from 'pino';

export interface LoggerContext {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly agentId?: string;
  /** Identifies a single agent run — lets per-run loop logs be grepped in isolation. */
  readonly agentRunId?: string;
  readonly requestId?: string;
  readonly sessionId?: string;
}

export function createLogger(name: string, context?: LoggerContext): pino.Logger {
  return pino({
    name,
    level: process.env['LOG_LEVEL'] ?? 'info',
    ...(context ? { base: { ...context } } : {}),
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const rootLogger = createLogger('clawix');
