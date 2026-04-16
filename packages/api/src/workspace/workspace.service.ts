// packages/api/src/workspace/workspace.service.ts
import * as path from 'path';
import * as fs from 'fs/promises';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import { UserAgentRepository } from '../db/user-agent.repository.js';
import { resolveWorkspacePaths } from '../engine/workspace-resolver.js';
import type { DirectoryListing, FileContent, FileEntry, FileType } from '@clawix/shared';
import { ScopedFs } from './scoped-fs.js';

const logger = createLogger('workspace');

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

const FILE_TYPE_MAP: Record<string, FileType> = {
  // code
  '.ts': 'code',
  '.tsx': 'code',
  '.js': 'code',
  '.jsx': 'code',
  '.py': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.java': 'code',
  '.c': 'code',
  '.cpp': 'code',
  '.h': 'code',
  '.css': 'code',
  '.scss': 'code',
  '.html': 'code',
  '.vue': 'code',
  '.svelte': 'code',
  '.sh': 'code',
  '.bash': 'code',
  '.zsh': 'code',
  '.sql': 'code',
  '.yaml': 'code',
  '.yml': 'code',
  '.toml': 'code',
  '.xml': 'code',
  '.rb': 'code',
  '.php': 'code',
  '.swift': 'code',
  '.kt': 'code',
  '.dockerfile': 'code',
  // markdown
  '.md': 'markdown',
  '.mdx': 'markdown',
  // json
  '.json': 'json',
  '.jsonc': 'json',
  '.json5': 'json',
  // text
  '.txt': 'text',
  '.log': 'text',
  '.env': 'text',
  '.gitignore': 'text',
  '.editorconfig': 'text',
  '.dockerignore': 'text',
  '.csv': 'text',
  // image
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.svg': 'image',
  '.webp': 'image',
  '.ico': 'image',
  // video
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  // audio
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  // pdf
  '.pdf': 'pdf',
  // archive
  '.zip': 'archive',
  '.tar': 'archive',
  '.gz': 'archive',
  '.rar': 'archive',
};

const BINARY_TYPES: ReadonlySet<FileType> = new Set(['image', 'video', 'audio', 'pdf', 'archive']);

const EDITABLE_TYPES: ReadonlySet<FileType> = new Set(['text', 'code', 'markdown', 'json']);

@Injectable()
export class WorkspaceService {
  constructor(private readonly userAgentRepo: UserAgentRepository) {}

  static detectFileType(filename: string): FileType {
    const ext = path.extname(filename).toLowerCase();
    return FILE_TYPE_MAP[ext] ?? 'unknown';
  }

  private async createScopedFs(userId: string): Promise<{ fs: ScopedFs; basePath: string }> {
    const userAgent = await this.userAgentRepo.findByUserId(userId);
    if (!userAgent) {
      throw new NotFoundException('No workspace found for this user');
    }

    const { localPath } = resolveWorkspacePaths(userAgent.workspacePath);
    await fs.mkdir(localPath, { recursive: true });
    return { fs: new ScopedFs(localPath), basePath: localPath };
  }

  async listDirectory(userId: string, dirPath: string): Promise<DirectoryListing> {
    const { fs: sfs, basePath } = await this.createScopedFs(userId);
    const resolved = sfs.resolve(dirPath);

    let stat: Awaited<ReturnType<typeof sfs.stat>>;
    try {
      stat = await sfs.stat(dirPath);
    } catch {
      throw new NotFoundException('Directory not found');
    }

    if (!stat.isDirectory()) {
      throw new BadRequestException('Path is not a directory');
    }

    const dirents = await sfs.readdir(dirPath);

    const entries: FileEntry[] = await Promise.all(
      dirents.map(async (dirent) => {
        const entryRelative = '/' + path.relative(basePath, path.join(resolved, dirent.name));
        const isDirectory = dirent.isDirectory();

        let size = 0;
        let modifiedAt = new Date().toISOString();

        try {
          const entryStat = await sfs.stat(entryRelative);
          size = isDirectory ? 0 : entryStat.size;
          modifiedAt = entryStat.mtime.toISOString();
        } catch {
          logger.warn({ entryRelative }, 'Failed to stat entry, using defaults');
        }

        return {
          name: dirent.name,
          path: entryRelative,
          size,
          modifiedAt,
          isDirectory,
          type: isDirectory ? ('directory' as const) : WorkspaceService.detectFileType(dirent.name),
        };
      }),
    );

    const sorted = [...entries].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const relativePath = '/' + path.relative(basePath, resolved);
    const normalizedPath = relativePath === '/.' ? '/' : relativePath;

    const parent =
      normalizedPath === '/' ? null : '/' + path.relative(basePath, path.dirname(resolved));

    return {
      path: normalizedPath === '/.' ? '/' : normalizedPath,
      parent: parent === '/.' ? '/' : parent,
      entries: sorted,
    };
  }

  private buildFileEntry(
    name: string,
    entryPath: string,
    isDirectory: boolean,
    size: number,
    modifiedAt: string,
  ): FileEntry {
    return {
      name,
      path: entryPath,
      size,
      modifiedAt,
      isDirectory,
      type: isDirectory ? ('directory' as const) : WorkspaceService.detectFileType(name),
    };
  }

  async readFile(userId: string, filePath: string): Promise<FileContent> {
    const { fs: sfs, basePath } = await this.createScopedFs(userId);
    const resolved = sfs.resolve(filePath);

    let stat: Awaited<ReturnType<typeof sfs.stat>>;
    try {
      stat = await sfs.stat(filePath);
    } catch {
      throw new NotFoundException('File not found');
    }

    if (stat.isDirectory()) {
      throw new BadRequestException('Path is a directory, not a file');
    }

    const name = path.basename(resolved);
    const type = WorkspaceService.detectFileType(name);
    const relativePath = '/' + path.relative(basePath, resolved);

    const base = {
      path: relativePath,
      name,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      type,
    };

    if (BINARY_TYPES.has(type)) {
      return { ...base, content: null, truncated: false };
    }

    if (stat.size > MAX_FILE_SIZE) {
      return { ...base, content: null, truncated: true };
    }

    const content = (await sfs.readFile(filePath, 'utf-8')) as string;
    return { ...base, content, truncated: false };
  }

  async updateFileContent(
    userId: string,
    filePath: string,
    content: string,
    expectedModifiedAt: string,
    force = false,
  ): Promise<{ path: string; size: number; modifiedAt: string }> {
    const { fs: sfs, basePath } = await this.createScopedFs(userId);
    const resolved = sfs.resolve(filePath);

    let stat: Awaited<ReturnType<typeof sfs.stat>>;
    try {
      stat = await sfs.stat(filePath);
    } catch {
      throw new NotFoundException('File not found');
    }

    if (stat.isDirectory()) {
      throw new BadRequestException('Path is a directory, not a file');
    }

    const relativePath = '/' + path.relative(basePath, resolved);

    if (!force) {
      const currentModifiedAt = stat.mtime.toISOString();
      if (currentModifiedAt !== expectedModifiedAt) {
        throw new ConflictException('File was modified since last read');
      }
    }

    const name = path.basename(resolved);
    const type = WorkspaceService.detectFileType(name);

    if (!EDITABLE_TYPES.has(type)) {
      throw new BadRequestException(`File type "${type}" is not editable`);
    }

    await sfs.writeFile(filePath, content);

    const newStat = await sfs.stat(filePath);
    logger.info({ userId, path: relativePath, size: newStat.size }, 'Updated file content');

    return {
      path: relativePath,
      size: newStat.size,
      modifiedAt: newStat.mtime.toISOString(),
    };
  }

  async createEntry(
    userId: string,
    entryPath: string,
    type: 'file' | 'directory',
  ): Promise<FileEntry> {
    const { fs: sfs, basePath } = await this.createScopedFs(userId);
    if (await sfs.exists(entryPath)) {
      throw new ConflictException('Path already exists');
    }
    if (type === 'directory') {
      await sfs.mkdir(entryPath);
    } else {
      await sfs.writeFile(entryPath, '');
    }
    const stat = await sfs.stat(entryPath);
    const resolved = sfs.resolve(entryPath);
    const name = path.basename(resolved);
    const relativePath = '/' + path.relative(basePath, resolved);
    logger.info({ userId, path: relativePath, type }, 'Created workspace entry');
    return this.buildFileEntry(
      name,
      relativePath,
      type === 'directory',
      type === 'directory' ? 0 : stat.size,
      stat.mtime.toISOString(),
    );
  }

  async renameEntry(userId: string, entryPath: string, newName: string): Promise<FileEntry> {
    const { fs: sfs, basePath } = await this.createScopedFs(userId);
    if (!(await sfs.exists(entryPath))) throw new NotFoundException('Path not found');
    const resolved = sfs.resolve(entryPath);
    const parentDir = path.dirname(resolved);
    const newResolved = path.join(parentDir, newName);
    const newRelativePath = '/' + path.relative(basePath, newResolved);
    if (await sfs.exists(newRelativePath))
      throw new ConflictException(`"${newName}" already exists in this directory`);
    await sfs.rename(entryPath, newRelativePath);
    const stat = await sfs.stat(newRelativePath);
    const isDirectory = stat.isDirectory();
    logger.info({ userId, from: entryPath, to: newRelativePath }, 'Renamed workspace entry');
    return this.buildFileEntry(
      newName,
      newRelativePath,
      isDirectory,
      isDirectory ? 0 : stat.size,
      stat.mtime.toISOString(),
    );
  }

  async moveEntry(userId: string, entryPath: string, destination: string): Promise<FileEntry> {
    const { fs: sfs, basePath } = await this.createScopedFs(userId);
    if (!(await sfs.exists(entryPath))) throw new NotFoundException('Source path not found');
    const destStat = await sfs.stat(destination).catch(() => null);
    if (!destStat?.isDirectory()) throw new NotFoundException('Destination directory not found');
    const resolved = sfs.resolve(entryPath);
    const name = path.basename(resolved);
    const destResolved = sfs.resolve(destination);
    const newResolved = path.join(destResolved, name);
    const newRelativePath = '/' + path.relative(basePath, newResolved);
    if (await sfs.exists(newRelativePath))
      throw new ConflictException(`"${name}" already exists at destination`);
    await sfs.rename(entryPath, newRelativePath);
    const stat = await sfs.stat(newRelativePath);
    const isDirectory = stat.isDirectory();
    logger.info({ userId, from: entryPath, to: newRelativePath }, 'Moved workspace entry');
    return this.buildFileEntry(
      name,
      newRelativePath,
      isDirectory,
      isDirectory ? 0 : stat.size,
      stat.mtime.toISOString(),
    );
  }

  async deleteEntry(userId: string, entryPath: string): Promise<{ path: string; deleted: true }> {
    const { fs: sfs, basePath } = await this.createScopedFs(userId);
    if (!(await sfs.exists(entryPath))) throw new NotFoundException('Path not found');
    const resolved = sfs.resolve(entryPath);
    const relativePath = '/' + path.relative(basePath, resolved);
    await sfs.remove(entryPath);
    logger.info({ userId, path: relativePath }, 'Deleted workspace entry');
    return { path: relativePath, deleted: true };
  }

  async downloadFile(
    userId: string,
    filePath: string,
  ): Promise<{
    stream: NodeJS.ReadableStream;
    filename: string;
    contentType: string;
    size: number;
  }> {
    const { fs: sfs } = await this.createScopedFs(userId);
    let stat: Awaited<ReturnType<typeof sfs.stat>>;
    try {
      stat = await sfs.stat(filePath);
    } catch {
      throw new NotFoundException('File not found');
    }
    if (stat.isDirectory()) throw new BadRequestException('Cannot download a directory');
    const resolved = sfs.resolve(filePath);
    const filename = path.basename(resolved);
    const type = WorkspaceService.detectFileType(filename);
    const contentTypeMap: Partial<Record<string, string>> = {
      image: 'image/*',
      video: 'video/*',
      audio: 'audio/*',
      pdf: 'application/pdf',
      archive: 'application/octet-stream',
      json: 'application/json',
      code: 'text/plain',
      text: 'text/plain',
      markdown: 'text/markdown',
    };
    return {
      stream: sfs.createReadStream(filePath),
      filename,
      contentType: contentTypeMap[type] ?? 'application/octet-stream',
      size: stat.size,
    };
  }

  async listProjectorItems(userId: string): Promise<{ name: string; path: string }[]> {
    const { fs: sfs } = await this.createScopedFs(userId);

    // Ensure /projector directory exists
    if (!(await sfs.exists('/projector'))) {
      return [];
    }

    const stat = await sfs.stat('/projector');
    if (!stat.isDirectory()) {
      return [];
    }

    const dirents = await sfs.readdir('/projector');
    const items: { name: string; path: string }[] = [];

    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      const indexPath = `/projector/${dirent.name}/index.html`;
      if (await sfs.exists(indexPath)) {
        items.push({ name: dirent.name, path: indexPath });
      }
    }

    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getProjectorItemHtml(
    userId: string,
    name: string,
  ): Promise<{ name: string; html: string }> {
    const { fs: sfs } = await this.createScopedFs(userId);
    const indexPath = `/projector/${name}/index.html`;

    if (!(await sfs.exists(indexPath))) {
      throw new NotFoundException(`Projector item "${name}" not found`);
    }

    const html = (await sfs.readFile(indexPath, 'utf-8')) as string;
    return { name, html };
  }

  async uploadFile(
    userId: string,
    dirPath: string,
    filename: string,
    data: Buffer,
    overwrite = false,
  ): Promise<FileEntry> {
    const { fs: sfs, basePath } = await this.createScopedFs(userId);
    if (dirPath !== '/') {
      const dirStat = await sfs.stat(dirPath).catch(() => null);
      if (!dirStat?.isDirectory()) throw new NotFoundException('Target directory not found');
    }
    const resolved = sfs.resolve(dirPath);
    const fileResolved = path.join(resolved, filename);
    const relativePath = '/' + path.relative(basePath, fileResolved);
    if (!overwrite && (await sfs.exists(relativePath)))
      throw new ConflictException(`"${filename}" already exists`);
    await sfs.writeFile(relativePath, data);
    const stat = await sfs.stat(relativePath);
    logger.info({ userId, path: relativePath, size: stat.size }, 'Uploaded file to workspace');
    return this.buildFileEntry(filename, relativePath, false, stat.size, stat.mtime.toISOString());
  }
}
