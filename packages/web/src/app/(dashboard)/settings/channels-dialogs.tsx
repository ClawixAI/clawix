'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ApiChannel } from './channels-tab';

// ------------------------------------------------------------------ //
//  Create Channel Dialog                                              //
// ------------------------------------------------------------------ //

export function CreateChannelDialog({
  open,
  onOpenChange,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSubmit: (form: FormData) => void;
}) {
  const [type, setType] = useState('telegram');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Channel</DialogTitle>
          <DialogDescription>Configure a new messaging channel.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-type">Type</Label>
            <select
              name="type"
              id="create-type"
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
              }}
            >
              <option value="telegram">Telegram</option>
              <option value="web">Web</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-name">Name</Label>
            <Input
              id="create-name"
              name="name"
              placeholder={type === 'telegram' ? 'Telegram Bot' : 'Web Dashboard'}
              required
            />
          </div>

          {type === 'telegram' && <TelegramConfigFields />}
          {type === 'web' && <WebConfigFields />}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Add Channel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ //
//  Edit Channel Dialog                                                //
// ------------------------------------------------------------------ //

export function EditChannelDialog({
  channel,
  onOpenChange,
  saving,
  onSubmit,
}: {
  channel: ApiChannel | null;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSubmit: (id: string, form: FormData) => void;
}) {
  if (!channel) return null;

  return (
    <Dialog open={channel !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure Channel</DialogTitle>
          <DialogDescription>Update settings for {channel.name}.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(channel.id, new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" name="name" defaultValue={channel.name} required />
          </div>

          {channel.type === 'telegram' && <TelegramConfigFields config={channel.config} />}
          {channel.type === 'web' && <WebConfigFields config={channel.config} />}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ //
//  Channel-Type Config Field Components                               //
// ------------------------------------------------------------------ //

function TelegramConfigFields({ config = {} }: { config?: Record<string, unknown> }) {
  const hasToken = typeof config['bot_token'] === 'string' && config['bot_token'].length > 0;
  const hasWebhookSecret =
    typeof config['webhook_secret'] === 'string' && config['webhook_secret'].length > 0;

  const [mode, setMode] = useState<string>((config['mode'] as string) ?? 'polling');

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="cfg-bot_token">Bot Token</Label>
        <Input
          id="cfg-bot_token"
          name="bot_token"
          placeholder={
            hasToken
              ? 'Token is set — leave blank to keep'
              : 'Enter Telegram bot token from @BotFather'
          }
        />
        <p className="text-xs text-muted-foreground">
          {hasToken
            ? 'Leave blank to keep the current token.'
            : 'Required for the bot to function.'}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="cfg-mode">Mode</Label>
        <select
          name="mode"
          id="cfg-mode"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
          }}
        >
          <option value="polling">Polling</option>
          <option value="webhook">Webhook</option>
        </select>
      </div>
      {mode === 'webhook' && (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cfg-webhook_url">Webhook URL</Label>
            <Input
              id="cfg-webhook_url"
              name="webhook_url"
              placeholder="https://your-domain.com/api/telegram/webhook"
              defaultValue={(config['webhook_url'] as string) ?? ''}
              required
            />
            <p className="text-xs text-muted-foreground">
              Public HTTPS URL that Telegram will send updates to.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cfg-webhook_secret">Webhook Secret</Label>
            <Input
              id="cfg-webhook_secret"
              name="webhook_secret"
              placeholder={
                hasWebhookSecret
                  ? 'Secret is set — leave blank to keep'
                  : 'Optional secret token for webhook verification'
              }
            />
            <p className="text-xs text-muted-foreground">
              {hasWebhookSecret
                ? 'Leave blank to keep the current secret.'
                : 'Optional. Used to verify incoming webhook requests.'}
            </p>
          </div>
        </>
      )}
    </>
  );
}

function WebConfigFields({ config = {} }: { config?: Record<string, unknown> }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="cfg-enableProgress"
          name="enableProgress"
          className="size-4 rounded border"
          defaultChecked={config['enableProgress'] !== false}
        />
        <Label htmlFor="cfg-enableProgress">Enable progress updates</Label>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="cfg-enableToolHints"
          name="enableToolHints"
          className="size-4 rounded border"
          defaultChecked={config['enableToolHints'] !== false}
        />
        <Label htmlFor="cfg-enableToolHints">Enable tool call hints</Label>
      </div>
    </>
  );
}
