// packages/api/src/workspace/scoped-fs.ts
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

import { BadRequestException } from '@nestjs/common';

export class ScopedFs {
  constructor(private readonly basePath: string) {}

  resolve(userPath: string): string {
    if (/[\x00-\x1f]/.test(userPath)) {
      throw new BadRequestException('Invalid path');
    }

    const cleaned = userPath.replace(/^\/+/, '');
    const resolved = cleaned === '' ? this.basePath : path.resolve(this.basePath, cleaned);

    if (resolved !== this.basePath && !resolved.startsWith(this.basePath + path.sep)) {
      throw new BadRequestException('Invalid path');
    }

    return resolved;
  }

  private validateResolved(resolved: string): void {
    if (fsSync.existsSync(resolved)) {
      const real = fsSync.realpathSync(resolved);
      if (real !== this.basePath && !real.startsWith(this.basePath + path.sep)) {
        throw new BadRequestException('Invalid path');
      }
    }
  }

  private resolveAndValidate(userPath: string): string {
    const resolved = this.resolve(userPath);
    this.validateResolved(resolved);
    return resolved;
  }

  async readdir(userPath: string): Promise<fsSync.Dirent[]> {
    const resolved = this.resolveAndValidate(userPath);
    return fs.readdir(resolved, { withFileTypes: true });
  }

  async stat(userPath: string): Promise<fsSync.Stats> {
    const resolved = this.resolveAndValidate(userPath);
    return fs.stat(resolved);
  }

  async readFile(userPath: string, encoding?: BufferEncoding): Promise<string | Buffer> {
    const resolved = this.resolveAndValidate(userPath);
    if (encoding) {
      return fs.readFile(resolved, encoding);
    }
    return fs.readFile(resolved);
  }

  async writeFile(userPath: string, content: string | Buffer): Promise<void> {
    const resolved = this.resolveAndValidate(userPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content);
  }

  async mkdir(userPath: string): Promise<void> {
    const resolved = this.resolveAndValidate(userPath);
    await fs.mkdir(resolved, { recursive: true });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const resolvedOld = this.resolveAndValidate(oldPath);
    const resolvedNew = this.resolve(newPath);

    if (resolvedNew !== this.basePath && !resolvedNew.startsWith(this.basePath + path.sep)) {
      throw new BadRequestException('Invalid path');
    }

    await fs.mkdir(path.dirname(resolvedNew), { recursive: true });
    await fs.rename(resolvedOld, resolvedNew);
  }

  async remove(userPath: string): Promise<void> {
    const resolved = this.resolveAndValidate(userPath);

    if (resolved === this.basePath) {
      throw new BadRequestException('Cannot delete workspace root');
    }

    await fs.rm(resolved, { recursive: true, force: true });
  }

  createReadStream(userPath: string): fsSync.ReadStream {
    const resolved = this.resolveAndValidate(userPath);
    return fsSync.createReadStream(resolved);
  }

  createWriteStream(userPath: string): fsSync.WriteStream {
    const resolved = this.resolveAndValidate(userPath);
    return fsSync.createWriteStream(resolved);
  }

  async exists(userPath: string): Promise<boolean> {
    const resolved = this.resolve(userPath);
    try {
      await fs.access(resolved);
      return true;
    } catch {
      return false;
    }
  }
}
