/** Root prefix for all Redis keys. */
export const REDIS_KEY_PREFIX = 'clawix:' as const;

/** Namespaced key prefixes for different subsystems. */
export const KEY_PREFIXES = {
  session: `${REDIS_KEY_PREFIX}session:`,
  rateLimit: `${REDIS_KEY_PREFIX}rl:`,
  cache: `${REDIS_KEY_PREFIX}cache:`,
  lock: `${REDIS_KEY_PREFIX}lock:`,
  agentResults: `${REDIS_KEY_PREFIX}agent:results:`,
  agentLock: `${REDIS_KEY_PREFIX}lock:agent:`,
  agentProcessing: `${REDIS_KEY_PREFIX}agent:processing:`,
  agentReinvokeCount: `${REDIS_KEY_PREFIX}agent:reinvoke-count:`,
} as const;

/** Default TTL values in seconds. */
export const DEFAULT_TTL = {
  session: 3600,
  rateLimit: 60,
  cache: 300,
  shortLived: 30,
  agentResults: 86400,
  agentLock: 300,
  agentReinvokeCount: 3600,
} as const;

/** Pub/sub channel names. */
export const PUBSUB_CHANNELS = {
  agentResultReady: `${REDIS_KEY_PREFIX}agent:result-ready`,
  channelResponseReady: `${REDIS_KEY_PREFIX}channel:response-ready`,
  cronResultReady: `${REDIS_KEY_PREFIX}cron:result-ready`,
  approvalFrame: `${REDIS_KEY_PREFIX}approval:frame`,
} as const;

/** Connection timeout in milliseconds. */
export const REDIS_CONNECT_TIMEOUT_MS = 5000;

/** Batch size for SCAN-based operations. */
export const SCAN_BATCH_SIZE = 100;
