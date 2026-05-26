import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createTaskSchema, updateTaskSchema, paginationSchema } from '@clawix/shared';

import { TasksService } from './tasks.service.js';

@ApiTags('tasks')
@Controller('api/v1/tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get()
  async findAll(@Query() query: unknown, @Req() req: any) {
    const pagination = paginationSchema.parse(query);
    const data = await this.service.findAll(req.user.sub, pagination);
    return { success: true, data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Post()
  async create(@Body() body: unknown, @Req() req: any) {
    const input = createTaskSchema.parse(body);
    const data = await this.service.create(req.user.sub, input);
    return { success: true, data };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const input = updateTaskSchema.parse(body);
    const data = await this.service.update(id, req.user.sub, input);
    return { success: true, data };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    const data = await this.service.remove(id, req.user.sub);
    return { success: true, data };
  }
}
