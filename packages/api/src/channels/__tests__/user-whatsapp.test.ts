import { describe, expect, it, vi } from 'vitest';

import { UserRepository } from '../../db/user.repository.js';

describe('UserRepository.findByWhatsappJid', () => {
  it('returns user when whatsappJid exists', async () => {
    const mockUser = {
      id: 'user-1',
      whatsappJid: '15551234567@s.whatsapp.net',
      isActive: true,
    };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(mockUser),
      },
    };
    const repo = new UserRepository(prisma as never);

    const result = await repo.findByWhatsappJid('15551234567@s.whatsapp.net');

    expect(result).toEqual(mockUser);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { whatsappJid: '15551234567@s.whatsapp.net' },
    });
  });

  it('returns null when whatsappJid not found', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const repo = new UserRepository(prisma as never);

    const result = await repo.findByWhatsappJid('19999999999@s.whatsapp.net');

    expect(result).toBeNull();
  });

  it('threads whatsappJid through create()', async () => {
    const created = { id: 'user-2', whatsappJid: '15551112222@s.whatsapp.net' };
    const prisma = {
      user: {
        create: vi.fn().mockResolvedValue(created),
      },
    };
    const repo = new UserRepository(prisma as never);

    await repo.create({
      email: 'a@b.c',
      name: 'A',
      passwordHash: 'h',
      policyId: 'p',
      whatsappJid: '15551112222@s.whatsapp.net',
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        whatsappJid: '15551112222@s.whatsapp.net',
      }),
    });
  });

  it('threads whatsappJid through update() (including null clears)', async () => {
    const prisma = {
      user: {
        update: vi.fn().mockResolvedValue({ id: 'user-3' }),
      },
    };
    const repo = new UserRepository(prisma as never);

    await repo.update('user-3', { whatsappJid: null });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-3' },
      data: expect.objectContaining({ whatsappJid: null }),
    });
  });
});
