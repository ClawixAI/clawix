'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Bot, CalendarClock, Coins, Loader2 } from 'lucide-react';
import { useAnimeOnMount, staggerFadeUp, STAGGER } from '@/lib/anime';
import { VantaBackground } from '@/components/ui/vanta-background';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { authFetch } from '@/lib/auth';

interface DashboardStats {
  totalRuns: number;
  activeAgents: number;
  tokenUsage: {
    totalTokens: number;
    totalEstimatedCostUsd: number;
  };
  scheduledTasks: number;
}

interface RecentRun {
  id: string;
  agentName: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

interface RecentActivity {
  id: string;
  userName: string;
  action: string;
  resource: string;
  createdAt: string;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusVariant(status: string) {
  switch (status) {
    case 'completed':
      return 'secondary' as const;
    case 'failed':
      return 'destructive' as const;
    case 'running':
      return 'default' as const;
    default:
      return 'outline' as const;
  }
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useAnimeOnMount(staggerFadeUp('[data-animate="stat-cards"] > div', { stagger: STAGGER.wide }));

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, runsRes, activityRes] = await Promise.all([
        authFetch<DashboardStats>('/api/v1/dashboard/stats'),
        authFetch<RecentRun[]>('/api/v1/dashboard/recent-runs'),
        authFetch<RecentActivity[]>('/api/v1/dashboard/recent-activity'),
      ]);
      setStats(statsRes);
      setRecentRuns(Array.isArray(runsRes) ? runsRes : []);
      setRecentActivity(Array.isArray(activityRes) ? activityRes : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const statCards = [
    {
      title: 'Total Runs',
      value: stats ? formatNumber(stats.totalRuns) : '—',
      subtitle: 'all time',
      icon: Activity,
    },
    {
      title: 'Active Agents',
      value: stats ? String(stats.activeAgents) : '—',
      subtitle: 'definitions',
      icon: Bot,
    },
    {
      title: 'Token Usage',
      value: stats ? formatNumber(stats.tokenUsage.totalTokens) : '—',
      subtitle: stats ? `$${stats.tokenUsage.totalEstimatedCostUsd.toFixed(2)} this month` : '',
      icon: Coins,
    },
    {
      title: 'Pending Tasks',
      value: stats ? String(stats.scheduledTasks) : '—',
      subtitle: 'in queue',
      icon: CalendarClock,
    },
  ];

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Here&apos;s an overview of your AI orchestration platform.
          </p>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <VantaBackground effect="topology" className="min-h-[calc(100vh-3.5rem)] p-6">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Here&apos;s an overview of your AI orchestration platform.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Stats cards */}
        <div data-animate="stat-cards" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <stat.icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">{stat.value}</div>
                {stat.subtitle && <p className="text-xs text-muted-foreground">{stat.subtitle}</p>}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Recent runs table */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Recent Agent Runs</CardTitle>
              <CardDescription>Latest activity across all agents.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentRuns.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No agent runs yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentRuns.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="font-medium">{run.agentName}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatDuration(run.durationMs)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatTimeAgo(run.startedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest actions in your workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentActivity.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No activity yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {recentActivity.map((activity) => (
                    <div key={activity.id} className="flex items-start gap-3">
                      <div className="mt-0.5 size-2 shrink-0 rounded-full bg-primary" />
                      <div className="flex-1 text-sm">
                        <p>
                          <span className="font-medium">{activity.userName}</span>{' '}
                          <span className="text-muted-foreground">{activity.action}</span>{' '}
                          <span>{activity.resource}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatTimeAgo(activity.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </VantaBackground>
  );
}
