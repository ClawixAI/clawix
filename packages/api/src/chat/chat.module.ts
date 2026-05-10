import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module.js';
import { EngineModule } from '../engine/engine.module.js';
import { ChatController } from './chat.controller.js';

@Module({
  imports: [DbModule, EngineModule],
  controllers: [ChatController],
})
export class ChatModule {}
