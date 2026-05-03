import * as path from 'path';

import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import * as fs from 'fs/promises';

import { scanContextContent } from './prompt-injection-scanner.js';

const logger = createLogger('engine:bootstrap-file');

/** Ordered list of bootstrap files to load from the workspace root. */
const DEFAULT_FILES = ['SOUL.md', 'USER.md'] as const;

export interface BootstrapSection {
  readonly filename: string;
  readonly content: string;
}

@Injectable()
export class BootstrapFileService {
  async loadBootstrapFiles(workspacePath: string): Promise<readonly BootstrapSection[]> {
    const sections: BootstrapSection[] = [];

    for (const filename of DEFAULT_FILES) {
      const filePath = path.join(workspacePath, filename);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const trimmed = content.trim();

        if (trimmed.length === 0) {
          logger.debug({ filePath }, 'Bootstrap file empty, skipping');
          continue;
        }

        const scan = scanContextContent(trimmed, filename);
        sections.push({ filename, content: scan.sanitized });
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (error.code === 'ENOENT') {
          logger.debug({ filePath }, 'Bootstrap file not found, skipping');
        } else {
          logger.warn(
            { filePath, error: error.message },
            'Failed to read bootstrap file, skipping',
          );
        }
      }
    }

    return sections;
  }
}
