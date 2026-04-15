// packages/api/src/workspace/workspace.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { JwtPayload } from '../auth/auth.types.js';
import { WorkspaceService } from './workspace.service.js';
import type { DirectoryListing, FileContent, FileEntry, DeleteResponse, UpdateContentResponse } from '@clawix/shared';
import { createEntrySchema, renameSchema, moveSchema, deleteSchema, updateContentSchema } from '@clawix/shared';

@ApiTags('workspace')
@Controller('api/v1/workspace')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get('projector')
  async listProjectorItems(
    @Req() req: { user: JwtPayload },
  ): Promise<{ success: boolean; data: { name: string; path: string }[] }> {
    const items = await this.workspaceService.listProjectorItems(req.user.sub);
    return { success: true, data: items };
  }

  @Get('projector/:name')
  async getProjectorItem(
    @Req() req: { user: JwtPayload },
    @Param('name') name: string,
  ): Promise<{ success: boolean; data: { name: string; html: string } }> {
    const data = await this.workspaceService.getProjectorItemHtml(req.user.sub, name);
    return { success: true, data };
  }

  @Get('files')
  async listFiles(
    @Req() req: { user: JwtPayload },
    @Query('path') dirPath?: string,
  ): Promise<DirectoryListing> {
    return this.workspaceService.listDirectory(req.user.sub, dirPath ?? '/');
  }

  @Get('files/content')
  async getFileContent(
    @Req() req: { user: JwtPayload },
    @Query('path') filePath?: string,
  ): Promise<FileContent> {
    if (!filePath) {
      throw new BadRequestException('path query parameter is required');
    }
    return this.workspaceService.readFile(req.user.sub, filePath);
  }

  @Put('files/content')
  async updateFileContent(
    @Req() req: { user: JwtPayload },
    @Body() body: unknown,
  ): Promise<UpdateContentResponse> {
    const parsed = updateContentSchema.parse(body);
    return this.workspaceService.updateFileContent(
      req.user.sub,
      parsed.path,
      parsed.content,
      parsed.expectedModifiedAt,
      parsed.force,
    );
  }

  @Post('files')
  async createEntry(
    @Req() req: { user: JwtPayload },
    @Body() body: unknown,
  ): Promise<FileEntry> {
    const parsed = createEntrySchema.parse(body);
    return this.workspaceService.createEntry(req.user.sub, parsed.path, parsed.type);
  }

  @Post('files/upload')
  async uploadFile(
    @Req() req: FastifyRequest & { user: JwtPayload },
    @Query('overwrite') overwrite?: string,
  ): Promise<FileEntry> {
    const data = await req.file();
    if (!data) {
      throw new BadRequestException('No file uploaded');
    }
    const pathField = data.fields['path'];
    const dirPath = (pathField && 'value' in pathField ? pathField.value : '/') as string;
    const buffer = await data.toBuffer();
    return this.workspaceService.uploadFile(
      req.user.sub,
      dirPath,
      data.filename,
      buffer,
      overwrite === 'true',
    );
  }

  @Patch('files/rename')
  async renameEntry(
    @Req() req: { user: JwtPayload },
    @Body() body: unknown,
  ): Promise<FileEntry> {
    const parsed = renameSchema.parse(body);
    return this.workspaceService.renameEntry(req.user.sub, parsed.path, parsed.newName);
  }

  @Patch('files/move')
  async moveEntry(
    @Req() req: { user: JwtPayload },
    @Body() body: unknown,
  ): Promise<FileEntry> {
    const parsed = moveSchema.parse(body);
    return this.workspaceService.moveEntry(req.user.sub, parsed.path, parsed.destination);
  }

  @Delete('files')
  async deleteEntry(
    @Req() req: { user: JwtPayload },
    @Body() body: unknown,
  ): Promise<DeleteResponse> {
    const parsed = deleteSchema.parse(body);
    return this.workspaceService.deleteEntry(req.user.sub, parsed.path);
  }

  @Get('files/download')
  async downloadFile(
    @Req() req: { user: JwtPayload },
    @Query('path') filePath?: string,
    @Res() reply?: FastifyReply,
  ): Promise<void> {
    if (!filePath) {
      throw new BadRequestException('path query parameter is required');
    }
    const { stream, filename, contentType, size } = await this.workspaceService.downloadFile(
      req.user.sub,
      filePath,
    );
    reply!.header('Content-Type', contentType);
    reply!.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply!.header('Content-Length', size);
    await reply!.send(stream);
  }
}
