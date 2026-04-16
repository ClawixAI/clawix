import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createProviderConfigSchema, updateProviderConfigSchema } from '@clawix/shared';
import type { CreateProviderConfigInput, UpdateProviderConfigInput } from '@clawix/shared';

import { Roles } from '../auth/roles.decorator.js';
import { UserRole } from '../generated/prisma/enums.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProviderConfigService } from './provider-config.service.js';

@ApiTags('admin/providers')
@Controller('admin/providers')
@Roles(UserRole.admin)
export class ProviderConfigController {
  constructor(private readonly providerConfigService: ProviderConfigService) {}

  @Get()
  findAll() {
    return this.providerConfigService.findAll();
  }

  @Get(':provider')
  findOne(@Param('provider') provider: string) {
    return this.providerConfigService.findByProvider(provider);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createProviderConfigSchema)) body: CreateProviderConfigInput) {
    return this.providerConfigService.create(body);
  }

  @Patch(':provider')
  update(
    @Param('provider') provider: string,
    @Body(new ZodValidationPipe(updateProviderConfigSchema)) body: UpdateProviderConfigInput,
  ) {
    return this.providerConfigService.update(provider, body);
  }

  @Delete(':provider')
  remove(@Param('provider') provider: string) {
    return this.providerConfigService.remove(provider);
  }
}
