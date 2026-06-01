import { describe, it, expect } from 'vitest';
import { buildConfig } from '../channels-tab';

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.append(key, value);
  return form;
}

describe('buildConfig — telegram', () => {
  it('includes webhook_url and webhook_secret in webhook mode (#109)', () => {
    const config = buildConfig(
      'telegram',
      fd({
        bot_token: 'tok',
        mode: 'webhook',
        webhook_url: 'https://example.com/hook',
        webhook_secret: 'sekret',
      }),
    );

    expect(config).toMatchObject({
      bot_token: 'tok',
      mode: 'webhook',
      webhook_url: 'https://example.com/hook',
      webhook_secret: 'sekret',
    });
  });

  it('omits blank webhook fields and preserves an existing secret', () => {
    const config = buildConfig('telegram', fd({ bot_token: 'tok', mode: 'polling' }), {
      webhook_secret: 'existing-secret',
    });

    expect(config['webhook_url']).toBeUndefined();
    expect(config['webhook_secret']).toBe('existing-secret');
    expect(config['mode']).toBe('polling');
  });
});
