/**
 * Prometheus metrics for agent-loop stability: the sub-agent executor's
 * concurrency slots plus the two force-stop backstops (watchdog, reaper).
 *
 * Registered once at module load time as prom-client singletons (prom-client
 * throws on duplicate registration). These power the leak-detector and
 * fire-rate alerts in `infra/observability/agent-loop.rules.yml`.
 *
 * NOTE: like the other engine `*-metrics.ts` modules, these register on the
 * default registry but are only observable once a `/metrics` scrape endpoint
 * is wired up.
 */

import { Counter, Gauge } from 'prom-client';

/** Sub-agent executor slots currently running a task. */
export const agentActiveSlots = new Gauge({
  name: 'clawix_agent_active_slots',
  help: 'Sub-agent executor slots currently running.',
});

/** Sub-agent tasks queued, waiting for a free slot. */
export const agentPendingQueue = new Gauge({
  name: 'clawix_agent_pending_queue',
  help: 'Sub-agent tasks waiting for a free concurrency slot.',
});

/** Configured slot ceiling (MAX_CONCURRENT_AGENTS) — the alert compares active against this. */
export const agentMaxConcurrent = new Gauge({
  name: 'clawix_agent_max_concurrent',
  help: 'Configured maximum concurrent sub-agent slots (MAX_CONCURRENT_AGENTS).',
});

/** Runs force-aborted by the executor watchdog because they never settled in time. */
export const agentWatchdogFiredTotal = new Counter({
  name: 'clawix_agent_watchdog_fired_total',
  help: 'Sub-agent runs force-aborted by the executor watchdog (never settled in time).',
});

/** Stale runs force-failed by the stale-run reaper (last-resort backstop). */
export const agentReaperReapedTotal = new Counter({
  name: 'clawix_agent_reaper_reaped_total',
  help: 'Stale agent runs force-failed by the stale-run reaper.',
});
