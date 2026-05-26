import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module.js';
import { PrismaModule } from '../prisma/index.js';
import { WikiController } from './wiki.controller.js';
import { WikiService } from './wiki.service.js';

@Module({
  imports: [PrismaModule, DbModule],
  controllers: [WikiController],
  providers: [WikiService],
  exports: [WikiService],
})
export class WikiModule {}
