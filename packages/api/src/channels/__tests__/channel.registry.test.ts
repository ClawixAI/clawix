import { describe, expect, it, vi } from 'vitest';

import { ChannelRegistry } from '../channel.registry.js';
import type { ChannelAdapter, ChannelAdapterConfig, ChannelAdapterFactory } from '@clawix/shared';

function mockFactory(): ChannelAdapterFactory {
  return vi.fn().mockReturnValue({
    id: 'ch-1',
    type: 'telegram',
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendMessage: vi.fn(),
    onMessage: vi.fn(),
  } satisfies ChannelAdapter);
}

describe('ChannelRegistry', () => {
  it('registers and creates a channel adapter', () => {
    const registry = new ChannelRegistry();
    const factory = mockFactory();

    registry.register('telegram', factory);

    const config: ChannelAdapterConfig = {
      id: 'ch-1',
      type: 'telegram',
      name: 'Telegram Bot',
      config: { botToken: 'test-token' },
    };
    const channel = registry.create('telegram', config);

    expect(channel.id).toBe('ch-1');
    expect(factory).toHaveBeenCalledWith(config);
  });

  it('throws when creating unregistered channel type', () => {
    const registry = new ChannelRegistry();

    expect(() =>
      registry.create('slack', {
        id: 'ch-2',
        type: 'slack',
        name: 'Slack',
        config: {},
      }),
    ).toThrow('No channel adapter registered for type: slack');
  });

  it('lists registered channel types', () => {
    const registry = new ChannelRegistry();
    registry.register('telegram', mockFactory());

    expect(registry.getRegistered()).toEqual(['telegram']);
  });

  it('throws on duplicate registration', () => {
    const registry = new ChannelRegistry();
    registry.register('telegram', mockFactory());

    expect(() => {
      registry.register('telegram', mockFactory());
    }).toThrow('Channel adapter already registered for type: telegram');
  });
});
