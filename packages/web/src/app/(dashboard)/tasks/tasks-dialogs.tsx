'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { authFetch } from '@/lib/auth';
import type {
  ApiAgentDefinition,
  ApiChannel,
  ApiTask,
  ApiUserProfile,
  ScheduleType,
  TaskFormState,
} from './tasks-types';

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // When task is null we're creating; otherwise editing.
  task: ApiTask | null;
  onSaved: () => void;
}

const SCHEDULE_HINTS: Record<ScheduleType, { placeholder: string; help: string }> = {
  cron: {
    placeholder: '0 9 * * *',
    help: 'Standard 5-field cron expression (min hour day month weekday).',
  },
  every: {
    placeholder: '30m',
    help: 'Interval: "30s", "5m", "2h" etc.',
  },
  at: {
    placeholder: '09:00',
    help: 'Daily time in HH:MM (24-hour) — runs once per day at this time.',
  },
};

function buildInitialForm(task: ApiTask | null): TaskFormState {
  if (!task) {
    return {
      agentDefinitionId: '',
      name: '',
      prompt: '',
      enabled: true,
      scheduleType: 'cron',
      scheduleValue: '',
      timezone: '',
      channelId: '',
    };
  }
  const sched = task.schedule;
  let scheduleType: ScheduleType = 'cron';
  let scheduleValue = '';
  let timezone = '';
  if (sched && typeof sched === 'object' && 'type' in sched) {
    scheduleType = sched.type;
    if (sched.type === 'cron') {
      scheduleValue = sched.expression;
      timezone = sched.tz ?? '';
    } else if (sched.type === 'every') {
      scheduleValue = sched.interval;
    } else if (sched.type === 'at') {
      scheduleValue = sched.time;
    }
  }
  return {
    agentDefinitionId: task.agentDefinitionId,
    name: task.name,
    prompt: task.prompt,
    enabled: task.enabled,
    scheduleType,
    scheduleValue,
    timezone,
    channelId: task.channelId ?? '',
  };
}

const NO_CHANNEL_VALUE = '__none__';

function channelTypeLabel(type: string): string {
  switch (type) {
    case 'web':
      return 'Web (Conversations)';
    case 'telegram':
      return 'Telegram';
    case 'whatsapp':
      return 'WhatsApp';
    default:
      return type;
  }
}

function userHasChannelIdentity(profile: ApiUserProfile | null, channelType: string): boolean {
  if (!profile) return false;
  switch (channelType) {
    case 'web':
      return true;
    case 'telegram':
      return Boolean(profile.telegramId);
    case 'whatsapp':
      return Boolean(profile.whatsappJid);
    default:
      // Unknown channel types — let it through and let the backend reject.
      return true;
  }
}

export function TaskFormDialog({ open, onOpenChange, task, onSaved }: TaskFormDialogProps) {
  const isEdit = task !== null;
  const [form, setForm] = useState<TaskFormState>(() => buildInitialForm(task));
  const [agentDefs, setAgentDefs] = useState<readonly ApiAgentDefinition[]>([]);
  const [channels, setChannels] = useState<readonly ApiChannel[]>([]);
  const [profile, setProfile] = useState<ApiUserProfile | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [refDataLoading, setRefDataLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Reminder dialog state — populated when the user picks a telegram /
  // whatsapp channel without the matching identity on their profile. The
  // pick is rejected (form.channelId stays put) and the modal points them
  // at /profile to add the missing ID.
  const [reminderChannelType, setReminderChannelType] = useState<string | null>(null);

  // Reset form whenever the dialog opens (or the task switches).
  useEffect(() => {
    if (open) {
      setForm(buildInitialForm(task));
      setError('');
    }
  }, [open, task]);

  // Load agent definitions for the picker. Cached on the component since the
  // list is short-lived and the dialog usually re-opens with the same set.
  useEffect(() => {
    if (!open || agentDefs.length > 0) return;
    setAgentsLoading(true);
    // /api/v1/agents returns a raw paginated envelope `{ data, meta }` —
    // no `{ success, data: {...} }` wrapper like /api/v1/tasks. The shape
    // mismatch between these two controllers is intentional; treat it
    // verbatim here.
    authFetch<{ data: ApiAgentDefinition[] }>('/api/v1/agents?limit=100')
      .then((res) => {
        setAgentDefs(res.data);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? `Failed to load agents: ${err.message}` : 'Failed to load agents',
        );
      })
      .finally(() => {
        setAgentsLoading(false);
      });
  }, [open, agentDefs.length]);

  // Load channels + user profile in parallel for the channel picker. We need
  // both before we can decide which channels the user actually has the
  // identity to use (telegramId / whatsappJid checks).
  useEffect(() => {
    if (!open || (channels.length > 0 && profile)) return;
    setRefDataLoading(true);
    Promise.all([
      authFetch<{ success: boolean; data: ApiChannel[] }>('/api/v1/channels'),
      authFetch<ApiUserProfile>('/api/v1/me'),
    ])
      .then(([channelsRes, meRes]) => {
        setChannels(channelsRes.data.filter((c) => c.isActive));
        setProfile(meRes);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error
            ? `Failed to load channels: ${err.message}`
            : 'Failed to load channels',
        );
      })
      .finally(() => {
        setRefDataLoading(false);
      });
  }, [open, channels.length, profile]);

  function handleChannelChange(value: string): void {
    if (value === NO_CHANNEL_VALUE) {
      setForm((f) => ({ ...f, channelId: '' }));
      return;
    }
    const picked = channels.find((c) => c.id === value);
    if (!picked) return;
    if (!userHasChannelIdentity(profile, picked.type)) {
      // Reject the pick — show the reminder modal pointing at /profile.
      setReminderChannelType(picked.type);
      return;
    }
    setForm((f) => ({ ...f, channelId: value }));
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError('');

    if (!form.agentDefinitionId) {
      setError('Pick an agent.');
      return;
    }
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!form.prompt.trim()) {
      setError('Prompt is required.');
      return;
    }
    if (!form.scheduleValue.trim()) {
      setError('Schedule value is required.');
      return;
    }

    let schedule: Record<string, string>;
    if (form.scheduleType === 'cron') {
      schedule = { type: 'cron', expression: form.scheduleValue.trim() };
      if (form.timezone.trim()) schedule['tz'] = form.timezone.trim();
    } else if (form.scheduleType === 'every') {
      schedule = { type: 'every', interval: form.scheduleValue.trim() };
    } else {
      schedule = { type: 'at', time: form.scheduleValue.trim() };
    }

    // Defensive double-check: handleChannelChange already prevents picking a
    // channel without the matching identity, but if the user's profile was
    // edited mid-flow we still surface the reminder rather than POSTing a
    // task that will fail to deliver.
    const picked = form.channelId ? channels.find((c) => c.id === form.channelId) : null;
    if (picked && !userHasChannelIdentity(profile, picked.type)) {
      setReminderChannelType(picked.type);
      return;
    }

    const channelIdPayload = form.channelId === '' ? null : form.channelId;

    setSaving(true);
    try {
      if (isEdit) {
        await authFetch(`/api/v1/tasks/${task.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: form.name.trim(),
            prompt: form.prompt.trim(),
            schedule,
            enabled: form.enabled,
            channelId: channelIdPayload,
          }),
        });
      } else {
        await authFetch('/api/v1/tasks', {
          method: 'POST',
          body: JSON.stringify({
            agentDefinitionId: form.agentDefinitionId,
            name: form.name.trim(),
            prompt: form.prompt.trim(),
            schedule,
            enabled: form.enabled,
            channelId: channelIdPayload,
          }),
        });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const hint = SCHEDULE_HINTS[form.scheduleType];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit schedule' : 'New schedule'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Update task name, prompt, schedule, and enabled state.'
                : 'Schedule an agent to run on a recurring cadence.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="task-name">Name</Label>
              <Input
                id="task-name"
                value={form.name}
                onChange={(e) => {
                  setForm((f) => ({ ...f, name: e.target.value }));
                }}
                placeholder="Daily report"
                disabled={saving}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="task-agent">Agent</Label>
              <Select
                value={form.agentDefinitionId}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, agentDefinitionId: v }));
                }}
                disabled={saving || isEdit}
              >
                <SelectTrigger id="task-agent">
                  <SelectValue placeholder={agentsLoading ? 'Loading agents…' : 'Pick an agent'} />
                </SelectTrigger>
                <SelectContent>
                  {agentDefs.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isEdit && (
                <p className="text-xs text-muted-foreground">
                  Agent cannot be changed after creation.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="task-channel">Deliver result to</Label>
              <Select
                value={form.channelId === '' ? NO_CHANNEL_VALUE : form.channelId}
                onValueChange={handleChannelChange}
                disabled={saving || refDataLoading}
              >
                <SelectTrigger id="task-channel">
                  <SelectValue
                    placeholder={refDataLoading ? 'Loading channels…' : 'Pick a channel'}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANNEL_VALUE}>None (headless — view in /tasks)</SelectItem>
                  {channels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} — {channelTypeLabel(c.type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Web delivers to the latest Conversations session. Telegram / WhatsApp require the
                matching ID on your profile.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="grid gap-2">
                <Label htmlFor="task-sched-type">Type</Label>
                <Select
                  value={form.scheduleType}
                  onValueChange={(v) => {
                    setForm((f) => ({ ...f, scheduleType: v as ScheduleType, scheduleValue: '' }));
                  }}
                  disabled={saving}
                >
                  <SelectTrigger id="task-sched-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cron">Cron</SelectItem>
                    <SelectItem value="every">Interval</SelectItem>
                    <SelectItem value="at">Daily at</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 grid gap-2">
                <Label htmlFor="task-sched-value">Schedule</Label>
                <Input
                  id="task-sched-value"
                  value={form.scheduleValue}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, scheduleValue: e.target.value }));
                  }}
                  placeholder={hint.placeholder}
                  disabled={saving}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{hint.help}</p>

            {form.scheduleType === 'cron' && (
              <div className="grid gap-2">
                <Label htmlFor="task-tz">Timezone (optional)</Label>
                <Input
                  id="task-tz"
                  value={form.timezone}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, timezone: e.target.value }));
                  }}
                  placeholder="Asia/Hong_Kong"
                  disabled={saving}
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="task-prompt">Prompt</Label>
              <Textarea
                id="task-prompt"
                rows={4}
                value={form.prompt}
                onChange={(e) => {
                  setForm((f) => ({ ...f, prompt: e.target.value }));
                }}
                placeholder="What should the agent do on each run?"
                disabled={saving}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="task-enabled" className="text-sm font-medium">
                  Enabled
                </Label>
                <p className="text-xs text-muted-foreground">
                  Disabled tasks stay in the list but don&apos;t fire.
                </p>
              </div>
              <Switch
                id="task-enabled"
                checked={form.enabled}
                onCheckedChange={(c) => {
                  setForm((f) => ({ ...f, enabled: c }));
                }}
                disabled={saving}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isEdit ? 'Save changes' : 'Create schedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <ChannelIdentityReminderDialog
        channelType={reminderChannelType}
        onClose={() => {
          setReminderChannelType(null);
        }}
      />
    </Dialog>
  );
}

interface ChannelIdentityReminderDialogProps {
  channelType: string | null;
  onClose: () => void;
}

function ChannelIdentityReminderDialog({
  channelType,
  onClose,
}: ChannelIdentityReminderDialogProps) {
  const open = channelType !== null;
  const label = channelType ? channelTypeLabel(channelType) : '';
  const idField =
    channelType === 'telegram'
      ? 'Telegram ID'
      : channelType === 'whatsapp'
        ? 'WhatsApp JID'
        : `${label} identity`;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Missing {idField}</AlertDialogTitle>
          <AlertDialogDescription>
            You haven&apos;t set a {idField} on your profile, so {label} can&apos;t deliver
            scheduled task results to you. Add it under Profile → Channels first, then come back and
            pick this channel.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>OK</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Link href="/profile" onClick={onClose}>
              Open profile
            </Link>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface DeleteTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: ApiTask | null;
  onDeleted: () => void;
}

export function DeleteTaskDialog({ open, onOpenChange, task, onDeleted }: DeleteTaskDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setError('');
  }, [open]);

  async function handleDelete() {
    if (!task) return;
    setDeleting(true);
    setError('');
    try {
      await authFetch(`/api/v1/tasks/${task.id}`, { method: 'DELETE' });
      onDeleted();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
          <AlertDialogDescription>
            {task ? (
              <>
                This permanently removes <span className="font-medium">{task.name}</span> and its
                run history. This cannot be undone.
              </>
            ) : (
              'This permanently removes the schedule and its run history.'
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleDelete();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
