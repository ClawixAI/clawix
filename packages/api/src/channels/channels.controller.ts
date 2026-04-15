import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ChannelRepository } from '../db/channel.repository.js';

/**
 * Public channels endpoint for authenticated users (non-admin).
 * Returns basic channel info without sensitive config.
 * Admin operations (create, update, delete) remain in AdminController.
 */
@ApiTags('channels')
@Controller('api/v1/channels')
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(private readonly channelRepo: ChannelRepository) {}

  /**
   * List all channels with basic info (no sensitive config).
   * Any authenticated user can access this endpoint.
   */
  @Get()
  async findAll() {
    const channels = await this.channelRepo.findAll({ page: 1, limit: 100 });
    // Return only public fields, exclude sensitive config
    const data = channels.data.map((ch) => ({
      id: ch.id,
      type: ch.type,
      name: ch.name,
      isActive: ch.isActive,
      createdAt: ch.createdAt,
      updatedAt: ch.updatedAt,
    }));
    return { success: true, data, total: channels.meta.total };
  }
}
