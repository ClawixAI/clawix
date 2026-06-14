'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  adminImportMcpServer,
  adminUpdateMcpServer,
  type AdminMcpServerDto,
  type UpdateMcpServerBody,
} from '@/lib/mcp';
import { buildImportBody } from './build-import-body';

/** One-click OAuth presets so admins don't hand-type provider scope/endpoint URLs. */
const OAUTH_PRESETS: Record<string, { authorizeUrl: string; tokenUrl: string; scopes: string }> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes:
      'openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets',
  },
};

/** Import (server == null) or edit (server != null) an MCP server. */
export function ImportDialog({
  server,
  open,
  onOpenChange,
  onDone,
}: {
  server: AdminMcpServerDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const editing = server !== null;
  const initialAuthType: 'none' | 'header' | 'oauth' =
    server?.authType === 'header' || server?.authType === 'oauth' ? server.authType : 'none';
  // In edit mode the auth type is fixed (changing it would orphan existing
  // connections/tokens); in import mode it's selectable.
  const [authType, setAuthType] = useState<'none' | 'header' | 'oauth'>(initialAuthType);
  const effectiveAuthType = editing ? initialAuthType : authType;

  // OAuth fields are controlled so a provider preset can fill them in one click.
  const [oauthAuthorizeUrl, setOauthAuthorizeUrl] = useState(server?.oauthAuthorizeUrl ?? '');
  const [oauthTokenUrl, setOauthTokenUrl] = useState(server?.oauthTokenUrl ?? '');
  const [oauthScopes, setOauthScopes] = useState(server?.oauthScopes ?? '');
  // Spec-native discovery: when on, authorize/token/scopes are resolved from the
  // server at connect time, so the admin supplies only the URL (+ optional client).
  const [oauthAutoDiscover, setOauthAutoDiscover] = useState(server?.oauthAutoDiscover ?? false);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  function applyPreset(key: string) {
    const p = OAUTH_PRESETS[key];
    if (!p) return;
    setOauthAuthorizeUrl(p.authorizeUrl);
    setOauthTokenUrl(p.tokenUrl);
    setOauthScopes(p.scopes);
  }

  async function submit(form: FormData) {
    setPending(true);
    setError('');
    try {
      if (server) {
        const body: UpdateMcpServerBody = {
          name: String(form.get('name') ?? '') || undefined,
          url: String(form.get('url') ?? '') || undefined,
          credentialFormat: String(form.get('credentialFormat') ?? '') || undefined,
          setupInstructionsMd: String(form.get('setupInstructionsMd') ?? '') || undefined,
        };
        if (initialAuthType === 'header') {
          body.authHeaderName = String(form.get('authHeaderName') ?? '') || undefined;
        }
        if (initialAuthType === 'oauth') {
          body.oauthAutoDiscover = oauthAutoDiscover;
          body.oauthAuthorizeUrl = oauthAuthorizeUrl || undefined;
          body.oauthTokenUrl = oauthTokenUrl || undefined;
          body.oauthScopes = oauthScopes || undefined;
          body.oauthClientId = String(form.get('oauthClientId') ?? '') || undefined;
          // Blank secret = keep the stored one.
          const secret = String(form.get('oauthClientSecret') ?? '');
          if (secret) body.oauthClientSecret = secret;
        }
        await adminUpdateMcpServer(server.id, body);
      } else {
        const r = buildImportBody(form);
        if (!r.ok) {
          setError(r.error);
          setPending(false);
          return;
        }
        await adminImportMcpServer(r.body);
      }
      onOpenChange(false);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : editing ? 'Save failed' : 'Import failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{server ? `Edit ${server.name}` : 'Import MCP Server'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update server metadata, endpoint, and auth configuration.'
              : 'Import server metadata. Users discover tools when they connect with their own credentials.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              name="name"
              defaultValue={server?.name ?? ''}
              required
              maxLength={100}
            />
          </div>

          {/* URL is editable in both modes (e.g. the sidecar moves host/port). */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="mcp-url">URL</Label>
            <Input
              id="mcp-url"
              name="url"
              type="url"
              placeholder="https://api.githubcopilot.com/mcp/"
              defaultValue={server?.url ?? ''}
              required
            />
          </div>

          {!editing && (
            <>
              <div className="flex flex-col gap-2">
                <Label>Transport</Label>
                <Select name="transportType" defaultValue="http">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">HTTP (streamable)</SelectItem>
                    <SelectItem value="sse">SSE (legacy)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Auth type</Label>
                <Select
                  name="authType"
                  value={authType}
                  onValueChange={(v) => setAuthType(v as 'none' | 'header' | 'oauth')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="header">Header token</SelectItem>
                    <SelectItem value="oauth">OAuth (Authorization Code + PKCE)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {effectiveAuthType === 'header' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="mcp-header">Auth header name</Label>
              <Input
                id="mcp-header"
                name="authHeaderName"
                defaultValue={server?.authHeaderName ?? 'Authorization'}
              />
            </div>
          )}

          {effectiveAuthType === 'oauth' && (
            <>
              {/* Mirror the controlled checkbox into the form so FormData captures it. */}
              <input
                type="hidden"
                name="oauthAutoDiscover"
                value={oauthAutoDiscover ? 'true' : 'false'}
              />
              <div className="flex items-start gap-2 rounded-md border p-3">
                <Checkbox
                  id="mcp-oauth-auto-discover"
                  checked={oauthAutoDiscover}
                  onCheckedChange={(c) => setOauthAutoDiscover(c === true)}
                />
                <div className="grid gap-1">
                  <Label htmlFor="mcp-oauth-auto-discover" className="cursor-pointer">
                    Auto-discover OAuth config (spec-native)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    For MCP servers that publish OAuth metadata (RFC 9728/8414). Clawix discovers
                    the authorize/token URLs and scopes — and registers a client automatically (RFC
                    7591) — from the server URL at connect time. Leave the client ID/secret below
                    blank unless the server lacks dynamic registration.
                  </p>
                </div>
              </div>

              {!oauthAutoDiscover && (
                <>
                  <div className="flex flex-col gap-2">
                    <Label>Provider preset</Label>
                    <Select defaultValue="custom" onValueChange={applyPreset}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="custom">Custom</SelectItem>
                        <SelectItem value="google">
                          Google Workspace (Gmail · Drive · Docs · Sheets)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Fills the authorize/token URLs and scopes below. You still enter the server
                      URL and your Google OAuth client ID/secret.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="mcp-oauth-authorize-url">
                      Authorize URL <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="mcp-oauth-authorize-url"
                      name="oauthAuthorizeUrl"
                      type="url"
                      placeholder="https://accounts.google.com/o/oauth2/v2/auth"
                      value={oauthAuthorizeUrl}
                      onChange={(e) => setOauthAuthorizeUrl(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="mcp-oauth-token-url">
                      Token URL <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="mcp-oauth-token-url"
                      name="oauthTokenUrl"
                      type="url"
                      placeholder="https://oauth2.googleapis.com/token"
                      value={oauthTokenUrl}
                      onChange={(e) => setOauthTokenUrl(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="mcp-oauth-scopes">
                      Scopes <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="mcp-oauth-scopes"
                      name="oauthScopes"
                      rows={3}
                      placeholder="openid email https://www.googleapis.com/auth/gmail.send"
                      value={oauthScopes}
                      onChange={(e) => setOauthScopes(e.target.value)}
                      required
                    />
                  </div>
                </>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="mcp-oauth-client-id">
                  Client ID{' '}
                  {oauthAutoDiscover ? (
                    <span className="text-muted-foreground">(optional fallback)</span>
                  ) : (
                    <span className="text-destructive">*</span>
                  )}
                </Label>
                <Input
                  id="mcp-oauth-client-id"
                  name="oauthClientId"
                  placeholder="123456789.apps.googleusercontent.com"
                  defaultValue={server?.oauthClientId ?? ''}
                  required={!oauthAutoDiscover}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="mcp-oauth-client-secret">
                  Client Secret{' '}
                  {editing && <span className="text-muted-foreground">(leave blank to keep)</span>}
                </Label>
                <Input
                  id="mcp-oauth-client-secret"
                  name="oauthClientSecret"
                  type="password"
                  placeholder={editing ? '••••••••' : 'GOCSPX-…'}
                  autoComplete="off"
                />
              </div>
            </>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="mcp-format">Credential format hint</Label>
            <Input
              id="mcp-format"
              name="credentialFormat"
              placeholder="Bearer {token}"
              defaultValue={server?.credentialFormat ?? ''}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="mcp-instructions">Setup instructions (markdown, shown to users)</Label>
            <Textarea
              id="mcp-instructions"
              name="setupInstructionsMd"
              rows={4}
              defaultValue={server?.setupInstructionsMd ?? ''}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Save' : 'Import'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
