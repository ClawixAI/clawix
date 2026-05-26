import { Controller, Get, NotFoundException, Param, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { paginationSchema } from '@clawix/shared';

import { TaskRepository } from '../db/task.repository.js';
import { TaskRunRepository } from '../db/task-run.repository.js';
import { TaskRunMessageRepository } from '../db/task-run-message.repository.js';

@ApiTags('task-runs')
@Controller('api/v1/tasks/:id')
export class TaskRunsController {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly taskRunRepo: TaskRunRepository,
    private readonly taskRunMessageRepo: TaskRunMessageRepository,
  ) {}

  @Get('runs')
  async listRuns(@Param('id') id: string, @Query() query: unknown, @Req() req: any) {
    const task = await this.taskRepo.findById(id);
    if (task.createdByUserId !== req.user.sub) {
      throw new NotFoundException('Task not found');
    }
    const pagination = paginationSchema.parse(query);
    const limit = Math.min(pagination.limit ?? 20, 50);
    const runs = await this.taskRunRepo.findByTaskIdWithLimit(id, limit);
    return { success: true, data: { runs } };
  }

  @Get('runs/:runId/messages')
  async runMessages(@Param('id') id: string, @Param('runId') runId: string, @Req() req: any) {
    const task = await this.taskRepo.findById(id);
    if (task.createdByUserId !== req.user.sub) {
      throw new NotFoundException('Task not found');
    }
    const run = await this.taskRunRepo.findById(runId);
    if (run.taskId !== id) {
      throw new NotFoundException('Run not found');
    }
    const messages = await this.taskRunMessageRepo.findByTaskRunId(runId);
    return { success: true, data: { run, messages } };
  }
}
