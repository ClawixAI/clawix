'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import anime from 'animejs';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { EASING, DURATION } from '@/lib/anime';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuth } from '@/components/auth-provider';
import { authFetch } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface TokenSummary {
  budget: {
    maxTokenBudget: number | null;
    budgetUsd: number | null;
    unlimited: boolean;
  };
  usage: {
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalEstimatedCostUsd: number;
  };
  period: {
    startDate: string;
    endDate: string;
  };
}

interface UserUsage {
  userId: string;
  userName: string;
  userEmail: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
}

interface AgentUsage {
  agentDefinitionId: string;
  agentName: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
}

interface DailyUsage {
  date: string;
  totalTokens: number;
  totalEstimatedCostUsd: number;
}

interface ModelUsage {
  model: string;
  totalTokens: number;
  totalEstimatedCostUsd: number;
}

// Slice colors — keep amber primary for the largest, then sky/emerald/violet
// for fall-off, ending in muted neutrals so a 6+ slice chart still reads
// without becoming a rainbow. Cycles if there are more models than colors.
const PIE_COLORS = [
  'hsl(39 100% 50%)', // amber primary
  'hsl(199 89% 60%)', // sky
  'hsl(160 75% 50%)', // emerald
  'hsl(262 70% 65%)', // violet
  'hsl(330 75% 65%)', // pink
  'hsl(220 15% 55%)', // muted slate
  'hsl(220 10% 35%)', // darker slate
];

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Format a USD amount for the budget strip. Small amounts (< $1) keep
 * sub-cent precision so accruing usage against a tiny budget (e.g. a $0.01
 * cap) is still visible instead of rounding to $0.00.
 */
function formatUsd(n: number): string {
  if (n !== 0 && Math.abs(n) < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function UsageLineChart({ data, maxValue }: { data: DailyUsage[]; maxValue: number }) {
  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);

  const chartHeight = 240;
  const chartWidth = 800;
  const paddingLeft = 60;
  const paddingBottom = 30;
  const paddingTop = 10;
  const paddingRight = 10;

  const drawWidth = chartWidth - paddingLeft - paddingRight;
  const drawHeight = chartHeight - paddingTop - paddingBottom;

  // Y-axis ticks (4 evenly spaced)
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxValue / 4) * i));

  // Points
  const points = data.map((d, i) => {
    const x = paddingLeft + (data.length > 1 ? (i / (data.length - 1)) * drawWidth : drawWidth / 2);
    const y = paddingTop + drawHeight - (d.totalTokens / maxValue) * drawHeight;
    return { x, y, ...d };
  });

  // SVG path
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Area fill path
  const areaPath = `${linePath} L ${points[points.length - 1]!.x} ${paddingTop + drawHeight} L ${points[0]!.x} ${paddingTop + drawHeight} Z`;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    if (lineRef.current) {
      const length = lineRef.current.getTotalLength();
      lineRef.current.style.strokeDasharray = String(length);
      lineRef.current.style.strokeDashoffset = String(length);
      anime({
        targets: lineRef.current,
        strokeDashoffset: [length, 0],
        duration: DURATION.chart,
        easing: EASING,
      });
    }

    if (areaRef.current) {
      // The fill itself is a gradient — fade the whole element in.
      anime({
        targets: areaRef.current,
        opacity: [0, 1],
        duration: 300,
        delay: DURATION.chart,
        easing: EASING,
      });
    }
  }, [data]);

  const lastPoint = points[points.length - 1];

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="h-[280px] w-full text-primary"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Gradient under the line — amber at the top fading into the page */}
          <linearGradient id="usage-area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          {/* Soft glow on the latest point */}
          <radialGradient id="usage-pulse" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Y-axis grid lines and labels */}
        {yTicks.map((tick) => {
          const y = paddingTop + drawHeight - (tick / maxValue) * drawHeight;
          return (
            <g key={tick}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={chartWidth - paddingRight}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.08}
              />
              <text
                x={paddingLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontSize={10}
              >
                {formatCompact(tick)}
              </text>
            </g>
          );
        })}

        {/* Gradient area fill */}
        <path ref={areaRef} d={areaPath} fill="url(#usage-area-fill)" fillOpacity={0} />

        {/* Line */}
        <path
          ref={lineRef}
          d={linePath}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.85}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data points — small subtle dots */}
        {points.slice(0, -1).map((p) => (
          <circle key={p.date} cx={p.x} cy={p.y} r={3} fill="currentColor" fillOpacity={0.6}>
            <title>{`${p.date}: ${formatNumber(p.totalTokens)} tokens`}</title>
          </circle>
        ))}
        {/* Latest point gets a glow halo + larger dot for emphasis */}
        {lastPoint ? (
          <g>
            <circle cx={lastPoint.x} cy={lastPoint.y} r={14} fill="url(#usage-pulse)" />
            <circle
              cx={lastPoint.x}
              cy={lastPoint.y}
              r={5}
              fill="currentColor"
              stroke="hsl(var(--background, 0 0% 5%))"
              strokeWidth={1.5}
            >
              <title>{`${lastPoint.date}: ${formatNumber(lastPoint.totalTokens)} tokens`}</title>
            </circle>
          </g>
        ) : null}

        {/* X-axis labels */}
        {points.map((p, i) => {
          // Show first, last, and evenly spaced labels
          const showLabel =
            data.length <= 7 ||
            i === 0 ||
            i === data.length - 1 ||
            i % Math.ceil(data.length / 6) === 0;
          if (!showLabel) return null;
          return (
            <text
              key={p.date}
              x={p.x}
              y={chartHeight - 5}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {p.date.slice(5)}
            </text>
          );
        })}

        {/* Y-axis label */}
        <text
          x={12}
          y={chartHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90, 12, ${chartHeight / 2})`}
          className="fill-muted-foreground"
          fontSize={11}
        >
          Tokens
        </text>
      </svg>
    </div>
  );
}

/**
 * Editorial stat tile: mono eyebrow, large tabular numeric, optional inline
 * progress bar showing how the value compares to a target. Variants:
 *   - tone="primary"  default amber accent
 *   - tone="positive" sky/emerald (Remaining when ample)
 *   - tone="critical" red wash + stripe (Utilization > 100%)
 */
function StatTile({
  eyebrow,
  value,
  unit,
  fillPct,
  tone = 'primary',
}: {
  eyebrow: string;
  value: string;
  unit?: string;
  /** 0–100 (or beyond). When provided, renders a thin progress bar. */
  fillPct?: number | null;
  tone?: 'primary' | 'positive' | 'critical' | 'neutral';
}) {
  const stripe =
    tone === 'critical'
      ? 'border-l-red-500/70'
      : tone === 'positive'
        ? 'border-l-sky-500/60'
        : tone === 'neutral'
          ? 'border-l-border'
          : 'border-l-primary/70';

  const fill =
    tone === 'critical' ? 'bg-red-500' : tone === 'positive' ? 'bg-sky-500' : 'bg-primary';

  const wash =
    tone === 'critical' ? 'bg-red-500/5' : tone === 'positive' ? 'bg-sky-500/5' : 'bg-card';

  const clamped = fillPct == null ? null : Math.min(100, Math.max(0, fillPct));
  const overflow = fillPct != null && fillPct > 100;

  return (
    <div
      className={cn(
        'group relative flex flex-col gap-3 overflow-hidden rounded-lg border border-l-[3px] p-5 transition-colors',
        stripe,
        wash,
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/80">
        {eyebrow}
      </span>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            'text-3xl font-semibold tabular-nums tracking-tight',
            tone === 'critical' && 'text-red-400',
          )}
        >
          {value}
        </span>
        {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
      </div>
      {clamped != null ? (
        <div className="mt-auto flex flex-col gap-1.5">
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-foreground/5">
            <div
              className={cn('h-full rounded-full transition-[width] duration-500', fill)}
              style={{ width: `${clamped}%` }}
            />
          </div>
          {overflow ? (
            <span className="font-mono text-[10px] uppercase tracking-wider text-red-400">
              over budget · {fillPct?.toFixed(0)}%
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ModelUsagePieChart({ data }: { data: ModelUsage[] }) {
  const total = data.reduce((acc, d) => acc + d.totalTokens, 0);
  if (data.length === 0 || total === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        No model usage this month yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-2">
      <div className="relative h-[260px] w-full">
        {/* Center label — total + unit, sits inside the donut hole */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            Total
          </span>
          <span className="text-xl font-semibold tabular-nums tracking-tight">
            {formatCompact(total)}
          </span>
          <span className="text-[10px] text-muted-foreground">tokens</span>
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="totalTokens"
              nameKey="model"
              innerRadius={62}
              outerRadius={98}
              paddingAngle={2}
              stroke="transparent"
            >
              {data.map((entry, i) => (
                <Cell key={entry.model} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              // Theme tokens (--popover / --border) hold full color values
              // (oklch / hsl), not channel components, so we plug them in
              // raw rather than wrapping them in another hsl().
              contentStyle={{
                background: 'var(--popover)',
                color: 'var(--popover-foreground)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              }}
              itemStyle={{ color: 'var(--popover-foreground)' }}
              labelStyle={{ color: 'var(--popover-foreground)', fontWeight: 600 }}
              formatter={(value: number, _name, payload) => {
                const pct = ((value / total) * 100).toFixed(1);
                const item = payload?.payload as ModelUsage | undefined;
                return [
                  `${formatNumber(value)} tokens (${pct}%) · ${formatCost(item?.totalEstimatedCostUsd ?? 0)}`,
                  item?.model ?? '',
                ];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {data.map((d, i) => {
          const pct = ((d.totalTokens / total) * 100).toFixed(1);
          return (
            <li key={d.model} className="flex items-center gap-2">
              <span
                className="inline-block size-3 shrink-0 rounded-sm"
                style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
              />
              <span className="flex-1 truncate font-mono text-xs">{d.model}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatNumber(d.totalTokens)}
              </span>
              <span className="w-12 tabular-nums text-right text-muted-foreground">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function UserBreakdownRow({ user }: { user: UserUsage }) {
  const [agents, setAgents] = useState<AgentUsage[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadAgents = useCallback(async () => {
    if (loaded) return;
    try {
      const res = await authFetch<AgentUsage[]>(`/api/v1/tokens/per-user/${user.userId}/agents`);
      setAgents(Array.isArray(res) ? res : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load per-agent breakdown');
    }
    setLoaded(true);
  }, [user.userId, loaded]);

  return (
    <Collapsible className="group/row">
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 border-b px-4 py-3 text-left text-sm hover:bg-muted/50"
        onClick={() => {
          void loadAgents();
        }}
      >
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]/row:rotate-90" />
        <span className="flex-1 font-medium">{user.userName}</span>
        <span className="w-24 text-right tabular-nums text-muted-foreground">
          {formatNumber(user.totalInputTokens)}
        </span>
        <span className="w-24 text-right tabular-nums text-muted-foreground">
          {formatNumber(user.totalOutputTokens)}
        </span>
        <span className="w-24 text-right tabular-nums font-medium">
          {formatNumber(user.totalTokens)}
        </span>
        <span className="w-20 text-right tabular-nums text-muted-foreground">
          {formatCost(user.totalEstimatedCostUsd)}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {agents.length === 0 && loaded ? (
          <div className="px-10 py-3 text-sm text-muted-foreground">No agent usage data.</div>
        ) : (
          <div className="bg-muted/30">
            {agents.map((agent) => (
              <div
                key={agent.agentDefinitionId}
                className="flex items-center gap-2 border-b border-muted px-4 py-2 text-sm last:border-b-0"
              >
                <span className="w-3.5" />
                <span className="flex-1 pl-4 text-muted-foreground">{agent.agentName}</span>
                <span className="w-24 text-right tabular-nums text-muted-foreground">
                  {formatNumber(agent.totalInputTokens)}
                </span>
                <span className="w-24 text-right tabular-nums text-muted-foreground">
                  {formatNumber(agent.totalOutputTokens)}
                </span>
                <span className="w-24 text-right tabular-nums">
                  {formatNumber(agent.totalTokens)}
                </span>
                <span className="w-20 text-right tabular-nums text-muted-foreground">
                  {formatCost(agent.totalEstimatedCostUsd)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function TokenUsagePage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState('daily');
  const [summary, setSummary] = useState<TokenSummary | null>(null);
  const [userBreakdown, setUserBreakdown] = useState<UserUsage[]>([]);
  const [chartData, setChartData] = useState<DailyUsage[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const myId = user?.sub;
      const [summaryRes, usersRes, chartRes, modelRes] = await Promise.all([
        authFetch<TokenSummary>('/api/v1/tokens/summary'),
        authFetch<UserUsage[]>('/api/v1/tokens/per-user'),
        authFetch<DailyUsage[]>(`/api/v1/tokens/usage-over-time?period=${period}`),
        myId
          ? authFetch<ModelUsage[]>(`/api/v1/tokens/per-user/${myId}/models`)
          : Promise.resolve([] as ModelUsage[]),
      ]);
      setSummary(summaryRes);
      setUserBreakdown(Array.isArray(usersRes) ? usersRes : []);
      setChartData(Array.isArray(chartRes) ? chartRes : []);
      setModelUsage(Array.isArray(modelRes) ? modelRes : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load token usage data', {
        id: 'tokens-fetch',
      });
    } finally {
      setLoading(false);
    }
  }, [period, user?.sub]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // The policy budget is denominated in USD (stored as cents on the policy,
  // exposed here as `budgetUsd`). Enforcement compares accrued *cost*, not raw
  // token count, against it — so the strip must be monetary end-to-end. The
  // token count is still surfaced as a subtitle on "Cost Used".
  const unlimited = summary?.budget.unlimited ?? false;
  const budgetUsd = summary?.budget.budgetUsd ?? null;
  const usedUsd = summary?.usage.totalEstimatedCostUsd ?? 0;
  const usedTokens = summary?.usage.totalTokens ?? 0;
  const remainingUsd = budgetUsd !== null && budgetUsd !== undefined ? budgetUsd - usedUsd : null;
  const utilPct = budgetUsd != null && budgetUsd > 0 ? (usedUsd / budgetUsd) * 100 : null;
  const stats: {
    eyebrow: string;
    value: string;
    unit?: string;
    fillPct?: number | null;
    tone: 'primary' | 'positive' | 'critical' | 'neutral';
  }[] = [
    {
      eyebrow: 'Monthly Budget',
      value: unlimited ? '∞' : formatUsd(budgetUsd ?? 0),
      unit: unlimited ? 'unlimited' : 'USD / mo',
      tone: unlimited ? 'positive' : 'neutral',
    },
    {
      eyebrow: 'Cost Used',
      value: formatUsd(usedUsd),
      unit: `${formatNumber(usedTokens)} tokens`,
      fillPct: utilPct,
      tone: utilPct != null && utilPct > 100 ? 'critical' : 'primary',
    },
    {
      eyebrow: 'Remaining',
      value: unlimited ? '∞' : remainingUsd !== null ? formatUsd(remainingUsd) : 'N/A',
      unit: unlimited ? 'unlimited' : remainingUsd !== null ? 'USD' : '',
      tone: remainingUsd != null && remainingUsd < 0 ? 'critical' : 'positive',
    },
    {
      eyebrow: 'Utilization',
      value: utilPct != null ? `${utilPct.toFixed(1)}%` : 'N/A',
      unit: utilPct != null ? 'of budget' : '',
      fillPct: utilPct,
      tone: utilPct != null && utilPct > 100 ? 'critical' : 'primary',
    },
  ];

  // Chart: normalize daily usage to max bar height
  const maxDaily = Math.max(...chartData.map((d) => d.totalTokens), 1);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="border-b border-border/60 pb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Token Usage</h1>
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground/70">
              consumption
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Monitor token consumption, costs, and budget utilization.
          </p>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Token Usage</h1>
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground/70">
            consumption
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Monitor token consumption, costs, and budget utilization.
        </p>
      </div>

      {/* Budget meter strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatTile key={stat.eyebrow} {...stat} />
        ))}
      </div>

      <Tabs value={period} onValueChange={setPeriod}>
        <TabsList>
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
        </TabsList>

        <TabsContent value={period} className="mt-4 flex flex-col gap-6">
          {/* Usage chart */}
          <Card>
            <CardHeader>
              <CardTitle>Usage Over Time</CardTitle>
              <CardDescription>Token consumption trend for the current month.</CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                  No usage data for this period.
                </div>
              ) : (
                <UsageLineChart data={chartData} maxValue={maxDaily} />
              )}
            </CardContent>
          </Card>

          {/* Per-model pie — caller's own usage */}
          <Card>
            <CardHeader>
              <CardTitle>Your Models This Month</CardTitle>
              <CardDescription>
                Token usage broken down by model across every agent you've used.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ModelUsagePieChart data={modelUsage} />
            </CardContent>
          </Card>

          {/* Per-user breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Per-User Breakdown</CardTitle>
              <CardDescription>
                Token usage and cost by user. Click a row to see agent-level details.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {/* Header */}
              <div className="flex items-center gap-2 border-b px-4 py-2 text-xs font-medium text-muted-foreground">
                <span className="w-3.5" />
                <span className="flex-1">User</span>
                <span className="w-24 text-right">Input</span>
                <span className="w-24 text-right">Output</span>
                <span className="w-24 text-right">Total</span>
                <span className="w-20 text-right">Est. Cost</span>
              </div>
              {userBreakdown.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No usage data for this period.
                </div>
              ) : (
                userBreakdown.map((user) => <UserBreakdownRow key={user.userId} user={user} />)
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
