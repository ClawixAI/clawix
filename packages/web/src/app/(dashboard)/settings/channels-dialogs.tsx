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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formString } from '@/lib/form';
import { FieldError } from '@/components/ui/field-error';
import {
  channelNameSchema,
  channelTelegramCreateSchema,
  parseForm,
  type FieldErrors,
} from '@/lib/validation';
import type { ApiChannel } from './channels-tab';

// ------------------------------------------------------------------ //
//  Constants                                                          //
// ------------------------------------------------------------------ //

const PLATFORM_DEFAULT_LABEL: Record<string, string> = {
  telegram: 'all',
  whatsapp: 'new',
  slack: 'off',
  web: 'all',
};

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
  const [errors, setErrors] = useState<FieldErrors>({});

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
            const form = new FormData(e.currentTarget);
            const base = {
              name: formString(form, 'name'),
              webhook_url: formString(form, 'webhook_url'),
            };
            const parsed =
              type === 'telegram'
                ? parseForm(channelTelegramCreateSchema, {
                    ...base,
                    bot_token: formString(form, 'bot_token'),
                  })
                : parseForm(channelNameSchema, base);
            if (!parsed.success) {
              setErrors(parsed.fieldErrors);
              return;
            }
            setErrors({});
            onSubmit(form);
          }}
          className="flex flex-col gap-4"
          noValidate
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
              <option value="whatsapp">WhatsApp</option>
              <option value="web">Web</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-name">Name</Label>
            <Input
              id="create-name"
              name="name"
              placeholder={namePlaceholder(type)}
              maxLength={100}
              aria-invalid={errors['name'] ? true : undefined}
              required
            />
            <FieldError message={errors['name']} />
          </div>

          {type === 'telegram' && <TelegramConfigFields requireToken errors={errors} />}
          {type === 'whatsapp' && <WhatsAppConfigFields />}
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
  const [errors, setErrors] = useState<FieldErrors>({});

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
            const form = new FormData(e.currentTarget);
            const parsed = parseForm(channelNameSchema, {
              name: formString(form, 'name'),
              webhook_url: formString(form, 'webhook_url'),
            });
            if (!parsed.success) {
              setErrors(parsed.fieldErrors);
              return;
            }
            setErrors({});
            onSubmit(channel.id, form);
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              name="name"
              defaultValue={channel.name}
              maxLength={100}
              aria-invalid={errors['name'] ? true : undefined}
              required
            />
            <FieldError message={errors['name']} />
          </div>

          {channel.type === 'telegram' && (
            <TelegramConfigFields config={channel.config} errors={errors} />
          )}
          {channel.type === 'whatsapp' && <WhatsAppConfigFields />}
          {channel.type === 'web' && <WebConfigFields config={channel.config} />}

          <ToolProgressField channelType={channel.type} defaultMode={channel.toolProgressMode} />

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

function namePlaceholder(type: string): string {
  switch (type) {
    case 'telegram':
      return 'Telegram Bot';
    case 'whatsapp':
      return 'WhatsApp Bot';
    case 'web':
      return 'Web Dashboard';
    default:
      return 'Channel name';
  }
}

function TelegramConfigFields({
  config = {},
  requireToken = false,
  errors,
}: {
  config?: Record<string, unknown>;
  requireToken?: boolean;
  errors?: FieldErrors;
}) {
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
          aria-invalid={errors?.['bot_token'] ? true : undefined}
          required={requireToken}
        />
        <FieldError message={errors?.['bot_token']} />
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
              type="url"
              placeholder="https://your-domain.com/api/telegram/webhook"
              defaultValue={(config['webhook_url'] as string) ?? ''}
              aria-invalid={errors?.['webhook_url'] ? true : undefined}
              required
            />
            <FieldError message={errors?.['webhook_url']} />
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

function WhatsAppConfigFields() {
  return (
    <div className="rounded-md border border-muted bg-muted/30 px-3 py-3 text-xs leading-relaxed text-muted-foreground space-y-2">
      <p>
        WhatsApp uses the Baileys library — pairing happens via QR code, no API token is required.
      </p>
      <p>
        After enabling this channel, watch the API server logs for an ASCII QR code and scan it from
        the bot phone&apos;s WhatsApp →{' '}
        <span className="font-medium text-foreground">Linked Devices → Link a Device</span>.
      </p>
      <p>
        Auth state persists at <code className="font-mono text-[11px]">$WHATSAPP_AUTH_DIR</code>{' '}
        (default <code className="font-mono text-[11px]">data/whatsapp-auth/&lt;channelId&gt;</code>
        ) — restarts won&apos;t re-prompt for QR. Authorize a user by setting their{' '}
        <code className="font-mono text-[11px]">whatsappJid</code> (e.g.{' '}
        <code className="font-mono text-[11px]">15551234567@s.whatsapp.net</code>).
      </p>
    </div>
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

// ------------------------------------------------------------------ //
//  Tool Progress Field                                                //
// ------------------------------------------------------------------ //

function ToolProgressField({
  channelType,
  defaultMode,
}: {
  channelType: string;
  defaultMode: string | null;
}) {
  const [mode, setMode] = useState<string>(defaultMode ?? 'default');
  const platformDefault = PLATFORM_DEFAULT_LABEL[channelType] ?? 'off';

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="edit-toolProgressMode">Tool progress</Label>
      <input type="hidden" name="toolProgressMode" value={mode === 'default' ? '' : mode} />
      <Select value={mode} onValueChange={setMode}>
        <SelectTrigger id="edit-toolProgressMode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default ({platformDefault})</SelectItem>
          <SelectItem value="off">Off — no tool bubbles</SelectItem>
          <SelectItem value="new">New — only when tool changes</SelectItem>
          <SelectItem value="all">All — every tool call (preview)</SelectItem>
          <SelectItem value="verbose">Verbose — every tool call (full args)</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Controls progress bubbles emitted between tool calls. Only applies when the agent has
        Streaming enabled.
      </p>
    </div>
  );
}
