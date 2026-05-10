import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module.js';
import { MemoryController } from './memory.controller.js';
import { MemoryService } from './memory.service.js';

@Module({
  imports: [DbModule],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
